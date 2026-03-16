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

import { createToolRouter, defineTool, hasNoOtherToolCalls } from "./router";
import type {
  ToolMap,
  ToolHandlerResponse,
  AppendToolResultFn,
} from "./types";
import type { ToolResultConfig } from "../types";

function createAppendSpy() {
  const calls: ToolResultConfig[] = [];
  const fn = Object.assign(
    async (config: ToolResultConfig) => { calls.push(config); },
    { executeWithOptions: (_opts: unknown, [config]: [ToolResultConfig]) => {
        calls.push(config);
        return Promise.resolve();
      },
    },
  ) as AppendToolResultFn;
  return { fn, calls };
}

function at<T>(arr: T[], index: number): T {
  const val = arr[index];
  if (val === undefined) throw new Error(`Index ${index} out of bounds`);
  return val;
}

describe("createToolRouter edge cases", () => {
  let appendSpy: ReturnType<typeof createAppendSpy>;

  beforeEach(() => {
    appendSpy = createAppendSpy();
  });

  // --- Empty tools ---

  it("hasTools returns false when no tools are registered", () => {
    const router = createToolRouter({
      tools: {} as ToolMap,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });

    expect(router.hasTools()).toBe(false);
    expect(router.getToolNames()).toEqual([]);
    expect(router.getToolDefinitions()).toEqual([]);
  });

  it("hasTools returns false when all tools are disabled", () => {
    const disabledTool = defineTool({
      name: "Off" as const,
      description: "disabled",
      schema: z.object({}),
      handler: async () => ({ toolResponse: "nope", data: null }),
      enabled: false,
    });

    const router = createToolRouter({
      tools: { Off: disabledTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });

    expect(router.hasTools()).toBe(false);
  });

  // --- processToolCalls with empty array ---

  it("returns empty results for empty toolCalls array", async () => {
    const echoTool = defineTool({
      name: "Echo" as const,
      description: "echo",
      schema: z.object({ text: z.string() }),
      handler: async (args: { text: string }) => ({
        toolResponse: args.text,
        data: { echoed: args.text },
      }),
    });

    const router = createToolRouter({
      tools: { Echo: echoTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });

    const results = await router.processToolCalls([]);
    expect(results).toEqual([]);
    expect(appendSpy.calls).toHaveLength(0);
  });

  // --- Both global and per-tool pre-hooks run in order ---

  it("global pre-hook runs before per-tool pre-hook", async () => {
    const order: string[] = [];

    const hookedTool = defineTool({
      name: "Hooked" as const,
      description: "hooked tool",
      schema: z.object({}),
      handler: async () => {
        order.push("handler");
        return { toolResponse: "ok", data: null };
      },
      hooks: {
        onPreToolUse: async () => {
          order.push("tool-pre");
          return {};
        },
      },
    });

    const router = createToolRouter({
      tools: { Hooked: hookedTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
      hooks: {
        onPreToolUse: async () => {
          order.push("global-pre");
          return {};
        },
      },
    });

    const parsed = router.parseToolCall({ id: "tc-1", name: "Hooked", args: {} });
    await router.processToolCalls([parsed], { turn: 1 });

    expect(order).toEqual(["global-pre", "tool-pre", "handler"]);
  });

  // --- Global pre-hook skip prevents per-tool pre-hook from running ---

  it("global pre-hook skip prevents per-tool pre-hook and handler", async () => {
    const order: string[] = [];

    const hookedTool = defineTool({
      name: "Hooked" as const,
      description: "hooked tool",
      schema: z.object({}),
      handler: async () => {
        order.push("handler");
        return { toolResponse: "ok", data: null };
      },
      hooks: {
        onPreToolUse: async () => {
          order.push("tool-pre");
          return {};
        },
      },
    });

    const router = createToolRouter({
      tools: { Hooked: hookedTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
      hooks: {
        onPreToolUse: async () => {
          order.push("global-pre-skip");
          return { skip: true };
        },
      },
    });

    const parsed = router.parseToolCall({ id: "tc-1", name: "Hooked", args: {} });
    await router.processToolCalls([parsed], { turn: 1 });

    expect(order).toEqual(["global-pre-skip"]);
  });

  // --- Both global and per-tool post-hooks run ---

  it("per-tool post-hook runs before global post-hook", async () => {
    const order: string[] = [];

    const hookedTool = defineTool({
      name: "Hooked" as const,
      description: "hooked tool",
      schema: z.object({}),
      handler: async () => ({ toolResponse: "ok", data: { value: 1 } }),
      hooks: {
        onPostToolUse: async () => {
          order.push("tool-post");
        },
      },
    });

    const router = createToolRouter({
      tools: { Hooked: hookedTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
      hooks: {
        onPostToolUse: async () => {
          order.push("global-post");
        },
      },
    });

    const parsed = router.parseToolCall({ id: "tc-1", name: "Hooked", args: {} });
    await router.processToolCalls([parsed], { turn: 1 });

    expect(order).toEqual(["tool-post", "global-post"]);
  });

  // --- Per-tool failure hook takes precedence over global ---

  it("per-tool failure hook takes precedence over global failure hook", async () => {
    const failTool = defineTool({
      name: "Fail" as const,
      description: "fails",
      schema: z.object({}),
      handler: async (): Promise<ToolHandlerResponse<null>> => {
        throw new Error("boom");
      },
      hooks: {
        onPostToolUseFailure: async () => ({
          fallbackContent: "tool-level recovery",
        }),
      },
    });

    const globalHookSpy = vi.fn(async () => ({
      fallbackContent: "global-level recovery",
    }));

    const router = createToolRouter({
      tools: { Fail: failTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
      hooks: {
        onPostToolUseFailure: globalHookSpy,
      },
    });

    const parsed = router.parseToolCall({ id: "tc-1", name: "Fail", args: {} });
    const results = await router.processToolCalls([parsed], { turn: 1 });

    expect(at(appendSpy.calls, 0).content).toBe("tool-level recovery");
    expect(at(results, 0).data).toEqual({ error: "Error: boom", recovered: true });
    expect(globalHookSpy).not.toHaveBeenCalled();
  });

  // --- Pre-hook modifiedArgs from both global and per-tool ---

  it("per-tool pre-hook modifiedArgs overrides global pre-hook modifiedArgs", async () => {
    let receivedArgs: { text: string } | null = null;

    const modTool = defineTool({
      name: "Mod" as const,
      description: "mod",
      schema: z.object({ text: z.string() }),
      handler: async (args: { text: string }) => {
        receivedArgs = args;
        return { toolResponse: args.text, data: null };
      },
      hooks: {
        onPreToolUse: async () => ({
          modifiedArgs: { text: "tool-modified" },
        }),
      },
    });

    const router = createToolRouter({
      tools: { Mod: modTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
      hooks: {
        onPreToolUse: async () => ({
          modifiedArgs: { text: "global-modified" },
        }),
      },
    });

    const parsed = router.parseToolCall({
      id: "tc-1",
      name: "Mod",
      args: { text: "original" },
    });
    await router.processToolCalls([parsed], { turn: 1 });

    expect(receivedArgs).toEqual({ text: "tool-modified" });
  });

  // --- Multiple unknown tool calls in parallel ---

  it("handles multiple unknown tools in parallel mode", async () => {
    const echoTool = defineTool({
      name: "Echo" as const,
      description: "echo",
      schema: z.object({ text: z.string() }),
      handler: async (args: { text: string }) => ({
        toolResponse: args.text,
        data: { echoed: args.text },
      }),
    });

    const router = createToolRouter({
      tools: { Echo: echoTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
      parallel: true,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = await router.processToolCalls([
      { id: "tc-1", name: "Unknown1", args: {} },
      { id: "tc-2", name: "Unknown2", args: {} },
    ] as any);

    expect(results).toHaveLength(2);
    expect(at(results, 0).data).toEqual({ error: "Unknown tool: Unknown1" });
    expect(at(results, 1).data).toEqual({ error: "Unknown tool: Unknown2" });
  });

  // --- Plugins can override tools by name ---

  it("plugin tool with same name as registered tool takes last-write precedence", async () => {
    const baseTool = defineTool({
      name: "MyTool" as const,
      description: "base version",
      schema: z.object({}),
      handler: async () => ({
        toolResponse: "base",
        data: { source: "base" },
      }),
    });

    const pluginTool: ToolMap[string] = {
      name: "MyTool",
      description: "plugin version",
      schema: z.object({}),
      handler: async () => ({
        toolResponse: "plugin",
        data: { source: "plugin" },
      }),
    };

    const router = createToolRouter({
      tools: { MyTool: baseTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
      plugins: [pluginTool],
    });

    const parsed = router.parseToolCall({ id: "tc-1", name: "MyTool", args: {} });
    const results = await router.processToolCalls([parsed]);

    expect(at(results, 0).data).toEqual({ source: "plugin" });
  });

  // --- processToolCallsByName with no matching calls ---

  it("processToolCallsByName returns empty when no calls match", async () => {
    const echoTool = defineTool({
      name: "Echo" as const,
      description: "echo",
      schema: z.object({ text: z.string() }),
      handler: async (args: { text: string }) => ({
        toolResponse: args.text,
        data: { echoed: args.text },
      }),
    });

    const router = createToolRouter({
      tools: { Echo: echoTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });

    const results = await router.processToolCallsByName(
      [],
      "Echo",
      async () => ({ toolResponse: "ok", data: null }),
    );

    expect(results).toEqual([]);
  });

  // --- Tool handler returning complex ToolMessageContent ---

  it("handles tool response as ContentPart array", async () => {
    const complexTool = defineTool({
      name: "Complex" as const,
      description: "returns complex content",
      schema: z.object({}),
      handler: async () => ({
        toolResponse: [
          { type: "text", text: "Part 1" },
          { type: "text", text: "Part 2" },
        ],
        data: null,
      }),
    });

    const router = createToolRouter({
      tools: { Complex: complexTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });

    const parsed = router.parseToolCall({ id: "tc-1", name: "Complex", args: {} });
    await router.processToolCalls([parsed]);

    const appended = at(appendSpy.calls, 0);
    expect(Array.isArray(appended.content)).toBe(true);
  });

  // --- Synchronous handler ---

  it("supports synchronous handler (not returning a promise)", async () => {
    const syncTool = defineTool({
      name: "Sync" as const,
      description: "sync handler",
      schema: z.object({ n: z.number() }),
      handler: (args: { n: number }): ToolHandlerResponse<{ doubled: number }> => ({
        toolResponse: `${args.n * 2}`,
        data: { doubled: args.n * 2 },
      }),
    });

    const router = createToolRouter({
      tools: { Sync: syncTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });

    const parsed = router.parseToolCall({ id: "tc-1", name: "Sync", args: { n: 5 } });
    const results = await router.processToolCalls([parsed]);

    expect(at(results, 0).data).toEqual({ doubled: 10 });
    expect(at(appendSpy.calls, 0).content).toBe("10");
  });

  // --- Default turn is 0 when no context provided ---

  it("default turn is 0 when processToolCalls context is omitted", async () => {
    let capturedTurn: number | undefined;

    const spyTool = defineTool({
      name: "Spy" as const,
      description: "spy",
      schema: z.object({}),
      handler: async () => ({ toolResponse: "ok", data: null }),
    });

    const router = createToolRouter({
      tools: { Spy: spyTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
      hooks: {
        onPostToolUse: async ({ turn }) => {
          capturedTurn = turn;
        },
      },
    });

    const parsed = router.parseToolCall({ id: "tc-1", name: "Spy", args: {} });
    await router.processToolCalls([parsed]);

    expect(capturedTurn).toBe(0);
  });

  // --- Per-tool failure hook suppress ---

  it("per-tool failure hook suppress appends JSON error content", async () => {
    const suppressTool = defineTool({
      name: "Suppress" as const,
      description: "suppresses errors",
      schema: z.object({}),
      handler: async (): Promise<ToolHandlerResponse<null>> => {
        throw new Error("suppressed error");
      },
      hooks: {
        onPostToolUseFailure: async () => ({ suppress: true }),
      },
    });

    const router = createToolRouter({
      tools: { Suppress: suppressTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });

    const parsed = router.parseToolCall({ id: "tc-1", name: "Suppress", args: {} });
    const results = await router.processToolCalls([parsed], { turn: 1 });

    expect(at(results, 0).data).toEqual({
      error: "Error: suppressed error",
      suppressed: true,
    });

    const content = at(appendSpy.calls, 0).content;
    expect(typeof content === "string").toBe(true);
    const parsed2 = JSON.parse(content as string);
    expect(parsed2.suppressed).toBe(true);
  });

  // --- Zod coercion during parsing ---

  it("zod schema coercion is applied during parseToolCall", () => {
    const coerceTool = defineTool({
      name: "Coerce" as const,
      description: "coerces",
      schema: z.object({
        count: z.number().default(10),
        label: z.string().optional(),
      }),
      handler: async () => ({ toolResponse: "ok", data: null }),
    });

    const router = createToolRouter({
      tools: { Coerce: coerceTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });

    const parsed = router.parseToolCall({
      id: "tc-1",
      name: "Coerce",
      args: {},
    });

    expect(parsed.args).toEqual({ count: 10 });
  });

  // --- getToolNames returns tool.name not the map key ---

  it("getToolNames uses tool name property not map key", () => {
    const tool = defineTool({
      name: "ActualName" as const,
      description: "named differently",
      schema: z.object({}),
      handler: async () => ({ toolResponse: "ok", data: null }),
    });

    const router = createToolRouter({
      tools: { MapKey: tool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
    });

    expect(router.getToolNames()).toContain("ActualName");
    expect(router.hasTool("ActualName")).toBe(true);
    expect(router.hasTool("MapKey")).toBe(false);
  });

  // --- Non-Error thrown by handler ---

  it("handles non-Error object thrown by handler", async () => {
    const throwStringTool = defineTool({
      name: "ThrowString" as const,
      description: "throws string",
      schema: z.object({}),
      handler: async (): Promise<ToolHandlerResponse<null>> => {
        throw "string error";
      },
    });

    const router = createToolRouter({
      tools: { ThrowString: throwStringTool } as const,
      threadId: "t-1",
      appendToolResult: appendSpy.fn,
      hooks: {
        onPostToolUseFailure: async () => ({
          fallbackContent: "recovered from string throw",
        }),
      },
    });

    const parsed = router.parseToolCall({ id: "tc-1", name: "ThrowString", args: {} });
    const results = await router.processToolCalls([parsed], { turn: 1 });

    expect(at(results, 0).data).toEqual({
      error: "string error",
      recovered: true,
    });
  });
});

describe("hasNoOtherToolCalls", () => {
  it("returns true when all calls match the excluded name", () => {
    const calls = [
      { id: "1", name: "AskUser", args: {} },
      { id: "2", name: "AskUser", args: {} },
    ];
    expect(hasNoOtherToolCalls(calls as any, "AskUser" as any)).toBe(true);
  });

  it("returns false when other calls exist", () => {
    const calls = [
      { id: "1", name: "AskUser", args: {} },
      { id: "2", name: "Echo", args: {} },
    ];
    expect(hasNoOtherToolCalls(calls as any, "AskUser" as any)).toBe(false);
  });

  it("returns true for empty array", () => {
    expect(hasNoOtherToolCalls([] as any, "AskUser" as any)).toBe(true);
  });
});
