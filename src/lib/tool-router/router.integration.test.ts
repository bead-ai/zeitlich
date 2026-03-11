import { describe, expect, it, vi, beforeEach } from "vitest";
import { z } from "zod";

vi.mock("@temporalio/workflow", () => {
  class MockApplicationFailure extends Error {
    nonRetryable?: boolean;
    static create({
      message,
      nonRetryable,
    }: {
      message: string;
      nonRetryable?: boolean;
    }) {
      const err = new MockApplicationFailure(message);
      err.nonRetryable = nonRetryable;
      return err;
    }
    static fromError(
      error: unknown,
      options?: { nonRetryable?: boolean },
    ) {
      const src = error instanceof Error ? error : new Error(String(error));
      const err = new MockApplicationFailure(src.message);
      err.nonRetryable = options?.nonRetryable;
      return err;
    }
  }
  return { ApplicationFailure: MockApplicationFailure };
});

import { createToolRouter, defineTool } from "./router";
import type {
  ToolMap,
  ToolHandlerResponse,
  RouterContext,
  AppendToolResultFn,
} from "./types";
import type { ToolResultConfig } from "../types";

// ---------------------------------------------------------------------------
// Test tool definitions
// ---------------------------------------------------------------------------

const echoTool = defineTool({
  name: "Echo" as const,
  description: "Echoes back the input",
  schema: z.object({ text: z.string() }),
  handler: async (args: { text: string }): Promise<ToolHandlerResponse<{ echoed: string }>> => ({
    toolResponse: `Echo: ${args.text}`,
    data: { echoed: args.text },
  }),
});

const mathTool = defineTool({
  name: "Add" as const,
  description: "Adds two numbers",
  schema: z.object({ a: z.number(), b: z.number() }),
  handler: async (args: { a: number; b: number }): Promise<ToolHandlerResponse<{ sum: number }>> => ({
    toolResponse: `Sum: ${args.a + args.b}`,
    data: { sum: args.a + args.b },
  }),
});

const failingTool = defineTool({
  name: "Fail" as const,
  description: "Always fails",
  schema: z.object({ reason: z.string() }),
  handler: async (args: { reason: string }): Promise<ToolHandlerResponse<null>> => {
    throw new Error(args.reason);
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function at<T>(arr: T[], index: number): T {
  const val = arr[index];
  if (val === undefined) throw new Error(`Index ${index} out of bounds`);
  return val;
}

function createTools() {
  return { Echo: echoTool, Add: mathTool } as const;
}

function createAppendSpy() {
  const calls: ToolResultConfig[] = [];
  const fn: AppendToolResultFn = async (config) => {
    calls.push(config);
  };
  return { fn, calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createToolRouter integration", () => {
  let appendSpy: ReturnType<typeof createAppendSpy>;

  beforeEach(() => {
    appendSpy = createAppendSpy();
  });

  // --- Basic setup ---

  it("exposes registered tool definitions", () => {
    const router = createToolRouter({
      tools: createTools(),
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });

    expect(router.hasTools()).toBe(true);
    expect(router.getToolNames()).toContain("Echo");
    expect(router.getToolNames()).toContain("Add");
    expect(router.hasTool("Echo")).toBe(true);
    expect(router.hasTool("NonExistent")).toBe(false);
  });

  it("returns tool definitions without handlers", () => {
    const router = createToolRouter({
      tools: createTools(),
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });
    const defs = router.getToolDefinitions();
    expect(defs).toHaveLength(2);
    for (const def of defs) {
      expect(def).toHaveProperty("name");
      expect(def).toHaveProperty("description");
      expect(def).toHaveProperty("schema");
      expect(def).not.toHaveProperty("handler");
    }
  });

  // --- parseToolCall ---

  it("parses valid tool calls with argument validation", () => {
    const router = createToolRouter({
      tools: createTools(),
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });

    const parsed = router.parseToolCall({
      id: "tc-1",
      name: "Echo",
      args: { text: "hello" },
    });

    expect(parsed.id).toBe("tc-1");
    expect(parsed.name).toBe("Echo");
    expect(parsed.args).toEqual({ text: "hello" });
  });

  it("rejects unknown tool names", () => {
    const router = createToolRouter({
      tools: createTools(),
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });

    expect(() =>
      router.parseToolCall({ id: "tc-1", name: "Unknown", args: {} }),
    ).toThrow("Tool Unknown not found");
  });

  it("rejects invalid arguments", () => {
    const router = createToolRouter({
      tools: createTools(),
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });

    expect(() =>
      router.parseToolCall({ id: "tc-1", name: "Echo", args: { text: 123 } }),
    ).toThrow();
  });

  // --- processToolCalls ---

  it("processes a single tool call and appends the result", async () => {
    const router = createToolRouter({
      tools: createTools(),
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });

    const parsed = router.parseToolCall({
      id: "tc-1",
      name: "Echo",
      args: { text: "world" },
    });

    const results = await router.processToolCalls([parsed]);

    expect(results).toHaveLength(1);
    expect(at(results, 0).name).toBe("Echo");
    expect(at(results, 0).data).toEqual({ echoed: "world" });

    expect(appendSpy.calls).toHaveLength(1);
    expect(at(appendSpy.calls, 0).toolCallId).toBe("tc-1");
    expect(at(appendSpy.calls, 0).toolName).toBe("Echo");
    expect(at(appendSpy.calls, 0).content).toBe("Echo: world");
  });

  it("processes multiple tool calls in parallel", async () => {
    const order: string[] = [];
    const slowEcho = defineTool({
      name: "Echo" as const,
      description: "slow echo",
      schema: z.object({ text: z.string() }),
      handler: async (args: { text: string }) => {
        order.push(`start-echo-${args.text}`);
        await new Promise((r) => setTimeout(r, 10));
        order.push(`end-echo-${args.text}`);
        return { toolResponse: args.text, data: { echoed: args.text } };
      },
    });

    const router = createToolRouter({
      tools: { Echo: slowEcho, Add: mathTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
      parallel: true,
    });

    const calls = [
      router.parseToolCall({ id: "tc-1", name: "Echo", args: { text: "a" } }),
      router.parseToolCall({ id: "tc-2", name: "Echo", args: { text: "b" } }),
    ];

    const results = await router.processToolCalls(calls);
    expect(results).toHaveLength(2);
    // Both starts should happen before both ends in parallel
    expect(order[0]).toBe("start-echo-a");
    expect(order[1]).toBe("start-echo-b");
  });

  it("processes multiple tool calls sequentially", async () => {
    const order: string[] = [];
    const slowEcho = defineTool({
      name: "Echo" as const,
      description: "slow echo",
      schema: z.object({ text: z.string() }),
      handler: async (args: { text: string }) => {
        order.push(`start-echo-${args.text}`);
        await new Promise((r) => setTimeout(r, 10));
        order.push(`end-echo-${args.text}`);
        return { toolResponse: args.text, data: { echoed: args.text } };
      },
    });

    const router = createToolRouter({
      tools: { Echo: slowEcho } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
      parallel: false,
    });

    const calls = [
      router.parseToolCall({ id: "tc-1", name: "Echo", args: { text: "a" } }),
      router.parseToolCall({ id: "tc-2", name: "Echo", args: { text: "b" } }),
    ];

    const results = await router.processToolCalls(calls);
    expect(results).toHaveLength(2);
    // Sequential: first finishes before second starts
    expect(order).toEqual([
      "start-echo-a",
      "end-echo-a",
      "start-echo-b",
      "end-echo-b",
    ]);
  });

  it("handles unknown tools gracefully during processing", async () => {
    const router = createToolRouter({
      tools: createTools(),
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });

    // Force an unknown tool call (bypassing parseToolCall validation)
    const results = await router.processToolCalls([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "tc-1", name: "NonExistent", args: {} } as any,
    ]);

    expect(results).toHaveLength(1);
    expect(at(results, 0).data).toEqual({ error: "Unknown tool: NonExistent" });
    expect(at(appendSpy.calls, 0).content).toContain("Unknown tool");
  });

  // --- RouterContext ---

  it("passes correct RouterContext to handlers", async () => {
    let capturedCtx: RouterContext | null = null;

    const spyTool = defineTool({
      name: "Spy" as const,
      description: "captures context",
      schema: z.object({}),
      handler: async (_args: Record<string, never>, ctx: RouterContext) => {
        capturedCtx = ctx;
        return { toolResponse: "ok", data: null };
      },
    });

    const router = createToolRouter({
      tools: { Spy: spyTool } as const,
      threadId: "thread-42",
      appendToolResult: appendSpy.fn,
    });

    const parsed = router.parseToolCall({ id: "tc-99", name: "Spy", args: {} });
    await router.processToolCalls([parsed], { sandboxId: "sandbox-1" });

    expect(capturedCtx).toEqual(
      expect.objectContaining({
        threadId: "thread-42",
        toolCallId: "tc-99",
        toolName: "Spy",
        sandboxId: "sandbox-1",
      }),
    );
  });

  // --- Hooks ---

  it("pre-hook can skip tool execution", async () => {
    const handlerSpy = vi.fn(async () => ({
      toolResponse: "should not run",
      data: null,
    }));

    const skipTool = defineTool({
      name: "Skippable" as const,
      description: "can be skipped",
      schema: z.object({}),
      handler: handlerSpy,
    });

    const router = createToolRouter({
      tools: { Skippable: skipTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
      hooks: {
        onPreToolUse: async () => ({ skip: true }),
      },
    });

    const parsed = router.parseToolCall({ id: "tc-1", name: "Skippable", args: {} });
    const results = await router.processToolCalls([parsed], { turn: 1 });

    expect(handlerSpy).not.toHaveBeenCalled();
    expect(results).toHaveLength(0);
    expect(at(appendSpy.calls, 0).content).toContain("Skipped by PreToolUse hook");
  });

  it("pre-hook can modify arguments", async () => {
    let receivedArgs: { text: string } | null = null;

    const modTool = defineTool({
      name: "Echo" as const,
      description: "echo",
      schema: z.object({ text: z.string() }),
      handler: async (args: { text: string }) => {
        receivedArgs = args;
        return { toolResponse: args.text, data: { echoed: args.text } };
      },
    });

    const router = createToolRouter({
      tools: { Echo: modTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
      hooks: {
        onPreToolUse: async () => ({
          modifiedArgs: { text: "modified" },
        }),
      },
    });

    const parsed = router.parseToolCall({
      id: "tc-1",
      name: "Echo",
      args: { text: "original" },
    });
    await router.processToolCalls([parsed], { turn: 1 });

    expect(receivedArgs).toEqual({ text: "modified" });
  });

  it("per-tool pre-hook can skip execution", async () => {
    const handlerSpy = vi.fn(async () => ({
      toolResponse: "nope",
      data: null,
    }));

    const hookTool = defineTool({
      name: "Hooked" as const,
      description: "has per-tool hook",
      schema: z.object({}),
      handler: handlerSpy,
      hooks: {
        onPreToolUse: async () => ({ skip: true }),
      },
    });

    const router = createToolRouter({
      tools: { Hooked: hookTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });

    const parsed = router.parseToolCall({ id: "tc-1", name: "Hooked", args: {} });
    const results = await router.processToolCalls([parsed], { turn: 1 });

    expect(handlerSpy).not.toHaveBeenCalled();
    expect(results).toHaveLength(0);
  });

  it("post-hook receives result and timing info", async () => {
    let hookData: { result: unknown; durationMs: number } | null = null;

    const router = createToolRouter({
      tools: createTools(),
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
      hooks: {
        onPostToolUse: async ({ result, durationMs }) => {
          hookData = { result, durationMs };
        },
      },
    });

    const parsed = router.parseToolCall({
      id: "tc-1",
      name: "Add",
      args: { a: 3, b: 4 },
    });
    await router.processToolCalls([parsed], { turn: 1 });

    expect(hookData).not.toBeNull();
    const data = hookData as unknown as { result: { data: unknown }; durationMs: number };
    expect(data.result.data).toEqual({ sum: 7 });
    expect(data.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("per-tool post-hook fires after execution", async () => {
    let hookResult: { sum: number } | null = null;

    const hookedMath = defineTool({
      name: "Add" as const,
      description: "adds numbers",
      schema: z.object({ a: z.number(), b: z.number() }),
      handler: async (args: { a: number; b: number }) => ({
        toolResponse: `${args.a + args.b}`,
        data: { sum: args.a + args.b },
      }),
      hooks: {
        onPostToolUse: async ({ result }) => {
          hookResult = result as { sum: number };
        },
      },
    });

    const router = createToolRouter({
      tools: { Add: hookedMath } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });

    const parsed = router.parseToolCall({
      id: "tc-1",
      name: "Add",
      args: { a: 10, b: 20 },
    });
    await router.processToolCalls([parsed], { turn: 1 });

    expect(hookResult).toEqual({ sum: 30 });
  });

  // --- Failure handling ---

  it("global failure hook can recover with fallback content", async () => {
    const router = createToolRouter({
      tools: { Fail: failingTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
      hooks: {
        onPostToolUseFailure: async () => ({
          fallbackContent: "recovered gracefully",
        }),
      },
    });

    const parsed = router.parseToolCall({
      id: "tc-1",
      name: "Fail",
      args: { reason: "boom" },
    });
    const results = await router.processToolCalls([parsed], { turn: 1 });

    expect(results).toHaveLength(1);
    expect(at(results, 0).data).toEqual({ error: "Error: boom", recovered: true });
    expect(at(appendSpy.calls, 0).content).toBe("recovered gracefully");
  });

  it("per-tool failure hook can suppress errors", async () => {
    const suppressTool = defineTool({
      name: "Fail" as const,
      description: "fails but suppresses",
      schema: z.object({ reason: z.string() }),
      handler: async (args: { reason: string }): Promise<ToolHandlerResponse<null>> => {
        throw new Error(args.reason);
      },
      hooks: {
        onPostToolUseFailure: async () => ({ suppress: true }),
      },
    });

    const router = createToolRouter({
      tools: { Fail: suppressTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });

    const parsed = router.parseToolCall({
      id: "tc-1",
      name: "Fail",
      args: { reason: "suppressed" },
    });
    const results = await router.processToolCalls([parsed], { turn: 1 });

    expect(results).toHaveLength(1);
    expect(at(results, 0).data).toEqual({
      error: "Error: suppressed",
      suppressed: true,
    });
  });

  it("throws when handler fails and no hook recovers", async () => {
    const router = createToolRouter({
      tools: { Fail: failingTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });

    const parsed = router.parseToolCall({
      id: "tc-1",
      name: "Fail",
      args: { reason: "unrecoverable" },
    });

    await expect(
      router.processToolCalls([parsed], { turn: 1 }),
    ).rejects.toThrow("unrecoverable");
  });

  // --- Disabled tools ---

  it("excludes disabled tools from definitions and parsing", () => {
    const disabledTool = defineTool({
      name: "Disabled" as const,
      description: "off",
      schema: z.object({}),
      handler: async () => ({ toolResponse: "nope", data: null }),
      enabled: false,
    });

    const router = createToolRouter({
      tools: { Echo: echoTool, Disabled: disabledTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });

    expect(router.hasTool("Disabled")).toBe(false);
    expect(router.getToolNames()).not.toContain("Disabled");
    expect(() =>
      router.parseToolCall({ id: "tc-1", name: "Disabled", args: {} }),
    ).toThrow("Tool Disabled not found");
  });

  // --- Plugins ---

  it("registers plugins alongside tools", async () => {
    const pluginTool: ToolMap[string] = {
      name: "PluginTool",
      description: "added via plugin",
      schema: z.object({ input: z.string() }),
      handler: async (args: { input: string }) => ({
        toolResponse: `plugin: ${args.input}`,
        data: { input: args.input },
      }),
    };

    const router = createToolRouter({
      tools: createTools(),
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
      plugins: [pluginTool],
    });

    expect(router.hasTool("PluginTool")).toBe(true);
    expect(router.getToolNames()).toContain("PluginTool");

    const parsed = router.parseToolCall({
      id: "tc-1",
      name: "PluginTool",
      args: { input: "hello" },
    });
    const results = await router.processToolCalls([parsed]);
    expect(at(results, 0).data).toEqual({ input: "hello" });
  });

  // --- processToolCallsByName ---

  it("processToolCallsByName filters and processes matching calls", async () => {
    const router = createToolRouter({
      tools: createTools(),
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });

    const calls = [
      router.parseToolCall({ id: "tc-1", name: "Echo", args: { text: "a" } }),
      router.parseToolCall({ id: "tc-2", name: "Add", args: { a: 1, b: 2 } }),
      router.parseToolCall({ id: "tc-3", name: "Echo", args: { text: "b" } }),
    ];

    const results = await router.processToolCallsByName(
      calls,
      "Echo",
      async (args: { text: string }) => ({
        toolResponse: `custom: ${args.text}`,
        data: { custom: args.text },
      }),
    );

    expect(results).toHaveLength(2);
    expect(at(results, 0).name).toBe("Echo");
    expect(at(results, 0).data).toEqual({ custom: "a" });
    expect(at(results, 1).data).toEqual({ custom: "b" });
    expect(appendSpy.calls).toHaveLength(2);
  });

  // --- filterByName / hasToolCall / getResultsByName ---

  it("utility methods work correctly", async () => {
    const router = createToolRouter({
      tools: createTools(),
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });

    const calls = [
      router.parseToolCall({ id: "tc-1", name: "Echo", args: { text: "a" } }),
      router.parseToolCall({ id: "tc-2", name: "Add", args: { a: 1, b: 2 } }),
    ];

    expect(router.filterByName(calls, "Echo")).toHaveLength(1);
    expect(router.hasToolCall(calls, "Echo")).toBe(true);
    expect(router.hasToolCall(calls, "Add")).toBe(true);

    const results = await router.processToolCalls(calls);
    expect(router.getResultsByName(results, "Echo")).toHaveLength(1);
    expect(router.getResultsByName(results, "Add")).toHaveLength(1);
  });

  // --- resultAppended flag ---

  it("skips appendToolResult when handler sets resultAppended", async () => {
    const selfAppendTool = defineTool({
      name: "SelfAppend" as const,
      description: "appends result itself",
      schema: z.object({}),
      handler: async () => ({
        toolResponse: "self-appended",
        data: null,
        resultAppended: true,
      }),
    });

    const router = createToolRouter({
      tools: { SelfAppend: selfAppendTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });

    const parsed = router.parseToolCall({ id: "tc-1", name: "SelfAppend", args: {} });
    await router.processToolCalls([parsed]);

    expect(appendSpy.calls).toHaveLength(0);
  });
});
