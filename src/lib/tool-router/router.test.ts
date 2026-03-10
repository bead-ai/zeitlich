import { describe, expect, it, vi, beforeEach } from "vitest";
import { z } from "zod";

vi.mock("@temporalio/workflow", () => ({
  ApplicationFailure: {
    fromError: (err: unknown, opts?: { nonRetryable?: boolean }): Error => {
      const e = err instanceof Error ? err : new Error(String(err));
      return Object.assign(e, { nonRetryable: opts?.nonRetryable });
    },
  },
}));

import { createToolRouter, defineTool, hasNoOtherToolCalls } from "./router";
import type { ToolMap, AppendToolResultFn, ToolHandlerResponse } from "./types";

const echoTool = defineTool({
  name: "Echo" as const,
  description: "Echoes input",
  schema: z.object({ message: z.string() }),
  handler: async (args) => ({
    toolResponse: args.message,
    data: { echoed: args.message },
  }),
});

const failTool = defineTool({
  name: "Fail" as const,
  description: "Always fails",
  schema: z.object({}),
  handler: async (): Promise<ToolHandlerResponse<null>> => {
    throw new Error("handler error");
  },
});

const disabledTool = defineTool({
  name: "Disabled" as const,
  description: "This tool is disabled",
  schema: z.object({}),
  enabled: false,
  handler: async () => ({ toolResponse: "ok", data: null }),
});

describe("createToolRouter", () => {
  let appendToolResult: AppendToolResultFn;
  const tools = { Echo: echoTool, Fail: failTool, Disabled: disabledTool } satisfies ToolMap;

  beforeEach(() => {
    appendToolResult = vi.fn().mockResolvedValue(undefined);
  });

  function makeRouter(
    overrides: Partial<Parameters<typeof createToolRouter<typeof tools>>[0]> = {},
  ): ReturnType<typeof createToolRouter<typeof tools>> {
    return createToolRouter({
      tools,
      threadId: "thread-1",
      appendToolResult,
      ...overrides,
    });
  }

  describe("hasTools", () => {
    it("returns true when enabled tools exist", () => {
      expect(makeRouter().hasTools()).toBe(true);
    });
  });

  describe("hasTool", () => {
    it("returns true for registered enabled tool", () => {
      expect(makeRouter().hasTool("Echo")).toBe(true);
    });

    it("returns false for disabled tool", () => {
      expect(makeRouter().hasTool("Disabled")).toBe(false);
    });

    it("returns false for unknown tool", () => {
      expect(makeRouter().hasTool("Unknown")).toBe(false);
    });
  });

  describe("getToolNames", () => {
    it("returns only enabled tool names", () => {
      const names = makeRouter().getToolNames();
      expect(names).toContain("Echo");
      expect(names).toContain("Fail");
      expect(names).not.toContain("Disabled");
    });
  });

  describe("getToolDefinitions", () => {
    it("returns definitions for enabled tools only", () => {
      const defs = makeRouter().getToolDefinitions();
      const defNames = defs.map((d) => d.name);
      expect(defNames).toContain("Echo");
      expect(defNames).not.toContain("Disabled");
    });
  });

  describe("parseToolCall", () => {
    it("parses valid tool call with schema validation", () => {
      const router = makeRouter();
      const parsed = router.parseToolCall({
        id: "call-1",
        name: "Echo",
        args: { message: "hello" },
      });
      expect(parsed.name).toBe("Echo");
      expect(parsed.args).toEqual({ message: "hello" });
      expect(parsed.id).toBe("call-1");
    });

    it("throws for unknown tool", () => {
      const router = makeRouter();
      expect(() =>
        router.parseToolCall({ id: "x", name: "Missing", args: {} })
      ).toThrow("Tool Missing not found");
    });

    it("throws for disabled tool", () => {
      const router = makeRouter();
      expect(() =>
        router.parseToolCall({ id: "x", name: "Disabled", args: {} })
      ).toThrow("Tool Disabled not found");
    });

    it("throws on invalid args", () => {
      const router = makeRouter();
      expect(() =>
        router.parseToolCall({ id: "x", name: "Echo", args: { message: 123 } })
      ).toThrow();
    });

    it("defaults id to empty string", () => {
      const router = makeRouter();
      const parsed = router.parseToolCall({ name: "Echo", args: { message: "hi" } });
      expect(parsed.id).toBe("");
    });
  });

  describe("processToolCalls", () => {
    it("processes a tool call and appends result", async () => {
      const router = makeRouter();
      const parsed = router.parseToolCall({
        id: "call-1",
        name: "Echo",
        args: { message: "hello" },
      });
      const results = await router.processToolCalls([parsed]);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(
        expect.objectContaining({ name: "Echo", data: { echoed: "hello" } }),
      );
      expect(appendToolResult).toHaveBeenCalledWith({
        threadId: "thread-1",
        toolCallId: "call-1",
        toolName: "Echo",
        content: "hello",
      });
    });

    it("returns empty array for empty input", async () => {
      const results = await makeRouter().processToolCalls([]);
      expect(results).toEqual([]);
    });

    it("handles unknown tool with error message", async () => {
      const router = makeRouter();
      const results = await router.processToolCalls([
        { id: "x", name: "Unknown", args: {} } as never,
      ]);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(
        expect.objectContaining({ data: { error: "Unknown tool: Unknown" } }),
      );
    });

    it("processes tools sequentially when parallel is false", async () => {
      const order: string[] = [];
      const seqTools = {
        A: defineTool({
          name: "A" as const,
          description: "a",
          schema: z.object({}),
          handler: async () => {
            order.push("A");
            return { toolResponse: "A", data: null };
          },
        }),
        B: defineTool({
          name: "B" as const,
          description: "b",
          schema: z.object({}),
          handler: async () => {
            order.push("B");
            return { toolResponse: "B", data: null };
          },
        }),
      } satisfies ToolMap;

      const router = createToolRouter({
        tools: seqTools,
        threadId: "t",
        appendToolResult,
        parallel: false,
      });

      await router.processToolCalls([
        { id: "1", name: "A", args: {} },
        { id: "2", name: "B", args: {} },
      ]);
      expect(order).toEqual(["A", "B"]);
    });
  });

  describe("hooks", () => {
    it("onPreToolUse can skip execution", async () => {
      const router = makeRouter({
        hooks: {
          onPreToolUse: () => ({ skip: true }),
        },
      });
      const parsed = router.parseToolCall({
        id: "c1",
        name: "Echo",
        args: { message: "hi" },
      });
      const results = await router.processToolCalls([parsed]);

      expect(results).toHaveLength(0);
      expect(appendToolResult).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("skipped"),
        }),
      );
    });

    it("onPreToolUse can modify args", async () => {
      const router = makeRouter({
        hooks: {
          onPreToolUse: () => ({ modifiedArgs: { message: "modified" } }),
        },
      });
      const parsed = router.parseToolCall({
        id: "c1",
        name: "Echo",
        args: { message: "original" },
      });
      const results = await router.processToolCalls([parsed]);

      expect(results[0]).toEqual(
        expect.objectContaining({ data: { echoed: "modified" } }),
      );
    });

    it("onPostToolUse is called after execution", async () => {
      const postHook = vi.fn();
      const router = makeRouter({
        hooks: { onPostToolUse: postHook },
      });
      const parsed = router.parseToolCall({
        id: "c1",
        name: "Echo",
        args: { message: "test" },
      });
      await router.processToolCalls([parsed]);

      expect(postHook).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "thread-1",
          turn: 0,
        }),
      );
    });

    it("onPostToolUseFailure can provide fallback content", async () => {
      const router = makeRouter({
        hooks: {
          onPostToolUseFailure: () => ({
            fallbackContent: "recovered!",
          }),
        },
      });
      const parsed = router.parseToolCall({ id: "c1", name: "Fail", args: {} });
      const results = await router.processToolCalls([parsed]);

      expect(results[0]).toEqual(
        expect.objectContaining({ data: expect.objectContaining({ recovered: true }) }),
      );
      expect(appendToolResult).toHaveBeenCalledWith(
        expect.objectContaining({ content: "recovered!" }),
      );
    });

    it("onPostToolUseFailure can suppress errors", async () => {
      const router = makeRouter({
        hooks: {
          onPostToolUseFailure: () => ({ suppress: true }),
        },
      });
      const parsed = router.parseToolCall({ id: "c1", name: "Fail", args: {} });
      const results = await router.processToolCalls([parsed]);

      expect(results[0]).toEqual(
        expect.objectContaining({ data: expect.objectContaining({ suppressed: true }) }),
      );
    });

    it("throws ApplicationFailure when no failure hook recovers", async () => {
      const router = makeRouter();
      const parsed = router.parseToolCall({ id: "c1", name: "Fail", args: {} });
      await expect(router.processToolCalls([parsed])).rejects.toThrow(
        "handler error",
      );
    });
  });

  describe("per-tool hooks", () => {
    it("per-tool onPreToolUse can skip", async () => {
      const toolsWithHooks = {
        Echo: defineTool({
          ...echoTool,
          hooks: {
            onPreToolUse: () => ({ skip: true }),
          },
        }),
      } satisfies ToolMap;

      const router = createToolRouter({
        tools: toolsWithHooks,
        threadId: "t",
        appendToolResult,
      });

      const parsed = router.parseToolCall({
        id: "c1",
        name: "Echo",
        args: { message: "hi" },
      });
      const results = await router.processToolCalls([parsed]);
      expect(results).toHaveLength(0);
    });

    it("per-tool onPostToolUseFailure can recover", async () => {
      const toolsWithHooks = {
        Fail: defineTool({
          ...failTool,
          hooks: {
            onPostToolUseFailure: () => ({
              fallbackContent: "tool-level recovery",
            }),
          },
        }),
      } satisfies ToolMap;

      const router = createToolRouter({
        tools: toolsWithHooks,
        threadId: "t",
        appendToolResult,
      });

      const parsed = router.parseToolCall({ id: "c1", name: "Fail", args: {} });
      const results = await router.processToolCalls([parsed]);
      expect(appendToolResult).toHaveBeenCalledWith(
        expect.objectContaining({ content: "tool-level recovery" }),
      );
      expect(results[0]).toEqual(
        expect.objectContaining({ data: expect.objectContaining({ recovered: true }) }),
      );
    });
  });

  describe("filterByName / hasToolCall / getResultsByName", () => {
    it("filterByName returns matching calls", () => {
      const router = makeRouter();
      const echoCall = router.parseToolCall({
        id: "1", name: "Echo", args: { message: "a" },
      });
      const failCall = router.parseToolCall({
        id: "2", name: "Fail", args: {},
      });
      const filtered = router.filterByName([echoCall, failCall], "Echo");
      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toEqual(expect.objectContaining({ name: "Echo" }));
    });

    it("hasToolCall detects presence", () => {
      const router = makeRouter();
      const call = router.parseToolCall({
        id: "1", name: "Echo", args: { message: "a" },
      });
      expect(router.hasToolCall([call], "Echo")).toBe(true);
      expect(router.hasToolCall([call], "Fail")).toBe(false);
    });

    it("getResultsByName filters results", async () => {
      const router = makeRouter();
      const echoParsed = router.parseToolCall({
        id: "1", name: "Echo", args: { message: "hi" },
      });
      const results = await router.processToolCalls([echoParsed]);
      const echoResults = router.getResultsByName(results, "Echo");
      expect(echoResults).toHaveLength(1);
      expect(echoResults[0]).toEqual(
        expect.objectContaining({ data: { echoed: "hi" } }),
      );
    });
  });

  describe("plugins", () => {
    it("auto-registers plugin tools", async () => {
      const pluginTool = defineTool({
        name: "Plugin" as const,
        description: "Plugin tool",
        schema: z.object({ value: z.string() }),
        handler: async (args) => ({
          toolResponse: args.value,
          data: { pluginValue: args.value },
        }),
      });

      const router = createToolRouter({
        tools: { Echo: echoTool } satisfies ToolMap,
        threadId: "t",
        appendToolResult,
        plugins: [pluginTool],
      });

      expect(router.hasTool("Plugin")).toBe(true);
      const parsed = router.parseToolCall({
        id: "p1",
        name: "Plugin",
        args: { value: "test" },
      });
      const results = await router.processToolCalls([parsed]);
      expect(results[0]).toEqual(
        expect.objectContaining({ data: { pluginValue: "test" } }),
      );
    });
  });

  describe("resultAppended", () => {
    it("skips appendToolResult when handler sets resultAppended", async () => {
      const selfAppendTool = defineTool({
        name: "SelfAppend" as const,
        description: "Appends own result",
        schema: z.object({}),
        handler: async () => ({
          toolResponse: "self-managed",
          data: null,
          resultAppended: true,
        }),
      });

      const router = createToolRouter({
        tools: { SelfAppend: selfAppendTool } satisfies ToolMap,
        threadId: "t",
        appendToolResult,
      });

      const parsed = router.parseToolCall({ id: "sa1", name: "SelfAppend", args: {} });
      await router.processToolCalls([parsed]);

      expect(appendToolResult).not.toHaveBeenCalled();
    });
  });
});

describe("hasNoOtherToolCalls", () => {
  it("returns true when all calls match exclude name", () => {
    const calls = [
      { id: "1", name: "Echo", args: { message: "a" } },
      { id: "2", name: "Echo", args: { message: "b" } },
    ];
    expect(hasNoOtherToolCalls(calls, "Echo" as never)).toBe(true);
  });

  it("returns false when other calls exist", () => {
    const calls = [
      { id: "1", name: "Echo", args: { message: "a" } },
      { id: "2", name: "Fail", args: {} },
    ];
    expect(hasNoOtherToolCalls(calls, "Echo" as never)).toBe(false);
  });
});
