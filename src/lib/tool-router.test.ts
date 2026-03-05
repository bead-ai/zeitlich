import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@temporalio/workflow", () => ({
  ApplicationFailure: {
    fromError: (error: unknown) => error,
  },
}));

import {
  createToolRouter,
  defineTool,
  hasNoOtherToolCalls,
  withAutoAppend,
  type ToolMap,
} from "./tool-router";

function echoTool() {
  return defineTool({
    name: "Echo",
    description: "Echoes input",
    schema: z.object({ message: z.string() }),
    handler: (args) => ({
      toolResponse: args.message,
      data: { echoed: args.message },
    }),
  });
}

function failTool() {
  return defineTool({
    name: "Fail",
    description: "Always fails",
    schema: z.object({}),
    handler: () => {
      throw new Error("intentional failure");
    },
  });
}

function makeTools() {
  return { Echo: echoTool(), Fail: failTool() } satisfies ToolMap;
}

const noopAppend = vi.fn(async () => {});

/** Asserts array has exactly one element and returns it */
function single<T>(arr: T[]): T {
  expect(arr).toHaveLength(1);
  return arr[0] as T;
}

describe("createToolRouter", () => {
  describe("hasTools", () => {
    it("returns true when tools exist", () => {
      const router = createToolRouter({
        tools: makeTools(),
        threadId: "t1",
        appendToolResult: noopAppend,
      });
      expect(router.hasTools()).toBe(true);
    });

    it("returns false when all tools are disabled", () => {
      const router = createToolRouter({
        tools: {
          Echo: { ...echoTool(), enabled: false },
        } satisfies ToolMap,
        threadId: "t1",
        appendToolResult: noopAppend,
      });
      expect(router.hasTools()).toBe(false);
    });
  });

  describe("hasTool", () => {
    it("returns true for registered tool", () => {
      const router = createToolRouter({
        tools: makeTools(),
        threadId: "t1",
        appendToolResult: noopAppend,
      });
      expect(router.hasTool("Echo")).toBe(true);
    });

    it("returns false for disabled tool", () => {
      const router = createToolRouter({
        tools: {
          Echo: { ...echoTool(), enabled: false },
        } satisfies ToolMap,
        threadId: "t1",
        appendToolResult: noopAppend,
      });
      expect(router.hasTool("Echo")).toBe(false);
    });

    it("returns false for unknown tool", () => {
      const router = createToolRouter({
        tools: makeTools(),
        threadId: "t1",
        appendToolResult: noopAppend,
      });
      expect(router.hasTool("Unknown")).toBe(false);
    });
  });

  describe("getToolNames", () => {
    it("returns all enabled tool names", () => {
      const router = createToolRouter({
        tools: makeTools(),
        threadId: "t1",
        appendToolResult: noopAppend,
      });
      expect(router.getToolNames()).toEqual(
        expect.arrayContaining(["Echo", "Fail"])
      );
    });

    it("excludes disabled tools", () => {
      const router = createToolRouter({
        tools: {
          Echo: echoTool(),
          Fail: { ...failTool(), enabled: false },
        } satisfies ToolMap,
        threadId: "t1",
        appendToolResult: noopAppend,
      });
      expect(router.getToolNames()).toEqual(["Echo"]);
    });
  });

  describe("getToolDefinitions", () => {
    it("returns definitions without handlers", () => {
      const router = createToolRouter({
        tools: { Echo: echoTool() } satisfies ToolMap,
        threadId: "t1",
        appendToolResult: noopAppend,
      });

      const defs = router.getToolDefinitions();
      expect(defs).toHaveLength(1);
      const def = single(defs);
      expect(def.name).toBe("Echo");
      expect(def.description).toBe("Echoes input");
      expect(def).not.toHaveProperty("handler");
    });
  });

  describe("parseToolCall", () => {
    it("parses valid tool call", () => {
      const router = createToolRouter({
        tools: makeTools(),
        threadId: "t1",
        appendToolResult: noopAppend,
      });

      const parsed = router.parseToolCall({
        id: "tc1",
        name: "Echo",
        args: { message: "hi" },
      });

      expect(parsed.id).toBe("tc1");
      expect(parsed.name).toBe("Echo");
      expect(parsed.args).toEqual({ message: "hi" });
    });

    it("throws for unknown tool", () => {
      const router = createToolRouter({
        tools: makeTools(),
        threadId: "t1",
        appendToolResult: noopAppend,
      });

      expect(() =>
        router.parseToolCall({ id: "tc1", name: "Unknown", args: {} })
      ).toThrow("not found");
    });

    it("throws for disabled tool", () => {
      const router = createToolRouter({
        tools: {
          Echo: { ...echoTool(), enabled: false },
        } satisfies ToolMap,
        threadId: "t1",
        appendToolResult: noopAppend,
      });

      expect(() =>
        router.parseToolCall({
          id: "tc1",
          name: "Echo",
          args: { message: "hi" },
        })
      ).toThrow("not found");
    });

    it("validates args against schema", () => {
      const router = createToolRouter({
        tools: makeTools(),
        threadId: "t1",
        appendToolResult: noopAppend,
      });

      expect(() =>
        router.parseToolCall({
          id: "tc1",
          name: "Echo",
          args: { message: 123 },
        })
      ).toThrow();
    });

    it("defaults id to empty string when not provided", () => {
      const router = createToolRouter({
        tools: makeTools(),
        threadId: "t1",
        appendToolResult: noopAppend,
      });

      const parsed = router.parseToolCall({
        name: "Echo",
        args: { message: "test" },
      });
      expect(parsed.id).toBe("");
    });
  });

  describe("processToolCalls", () => {
    it("processes tool call and returns result", async () => {
      const append = vi.fn(async () => {});
      const router = createToolRouter({
        tools: makeTools(),
        threadId: "t1",
        appendToolResult: append,
      });

      const parsed = router.parseToolCall({
        id: "tc1",
        name: "Echo",
        args: { message: "hello" },
      });

      const results = await router.processToolCalls([parsed]);
      const result = single(results);
      expect(result.name).toBe("Echo");
      expect(result.data).toEqual({ echoed: "hello" });
      expect(append).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "t1",
          toolCallId: "tc1",
          toolName: "Echo",
          content: "hello",
        })
      );
    });

    it("returns empty array for no tool calls", async () => {
      const router = createToolRouter({
        tools: makeTools(),
        threadId: "t1",
        appendToolResult: noopAppend,
      });

      const results = await router.processToolCalls([]);
      expect(results).toEqual([]);
    });

    it("re-throws handler errors as ApplicationFailure", async () => {
      const router = createToolRouter({
        tools: makeTools(),
        threadId: "t1",
        appendToolResult: noopAppend,
      });

      const parsed = router.parseToolCall({
        id: "tc1",
        name: "Fail",
        args: {},
      });

      await expect(router.processToolCalls([parsed])).rejects.toThrow(
        "intentional failure"
      );
    });

    it("handles unknown tool gracefully", async () => {
      const append = vi.fn(async () => {});
      const router = createToolRouter({
        tools: makeTools(),
        threadId: "t1",
        appendToolResult: append,
      });

      const fakeCall = { id: "tc1", name: "Ghost", args: {} };
      const results = await router.processToolCalls(
        [fakeCall] as Parameters<typeof router.processToolCalls>[0]
      );

      const result = single(results);
      expect(result.data).toEqual({ error: "Unknown tool: Ghost" });
    });
  });

  describe("processToolCalls with parallel: true", () => {
    it("processes multiple calls in parallel", async () => {
      const router = createToolRouter({
        tools: makeTools(),
        threadId: "t1",
        appendToolResult: noopAppend,
        parallel: true,
      });

      const p1 = router.parseToolCall({
        id: "tc1",
        name: "Echo",
        args: { message: "a" },
      });
      const p2 = router.parseToolCall({
        id: "tc2",
        name: "Echo",
        args: { message: "b" },
      });

      const results = await router.processToolCalls([p1, p2]);
      expect(results).toHaveLength(2);
    });
  });

  describe("hooks", () => {
    it("onPreToolUse can skip a tool call", async () => {
      const append = vi.fn(async () => {});
      const router = createToolRouter({
        tools: makeTools(),
        threadId: "t1",
        appendToolResult: append,
        hooks: {
          onPreToolUse: () => ({ skip: true }),
        },
      });

      const parsed = router.parseToolCall({
        id: "tc1",
        name: "Echo",
        args: { message: "hi" },
      });
      const results = await router.processToolCalls([parsed]);

      expect(results).toHaveLength(0);
      expect(append).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("skipped"),
        })
      );
    });

    it("onPreToolUse can modify args", async () => {
      const router = createToolRouter({
        tools: makeTools(),
        threadId: "t1",
        appendToolResult: noopAppend,
        hooks: {
          onPreToolUse: () => ({
            modifiedArgs: { message: "modified" },
          }),
        },
      });

      const parsed = router.parseToolCall({
        id: "tc1",
        name: "Echo",
        args: { message: "original" },
      });
      const results = await router.processToolCalls([parsed]);

      expect(single(results).data).toEqual({ echoed: "modified" });
    });

    it("onPostToolUse is called after successful execution", async () => {
      const postHook = vi.fn();
      const router = createToolRouter({
        tools: makeTools(),
        threadId: "t1",
        appendToolResult: noopAppend,
        hooks: { onPostToolUse: postHook },
      });

      const parsed = router.parseToolCall({
        id: "tc1",
        name: "Echo",
        args: { message: "hi" },
      });
      await router.processToolCalls([parsed]);

      expect(postHook).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "t1",
          turn: 0,
        })
      );
    });

    it("onPostToolUseFailure can recover with fallback", async () => {
      const router = createToolRouter({
        tools: makeTools(),
        threadId: "t1",
        appendToolResult: noopAppend,
        hooks: {
          onPostToolUseFailure: () => ({
            fallbackContent: "recovered",
          }),
        },
      });

      const parsed = router.parseToolCall({
        id: "tc1",
        name: "Fail",
        args: {},
      });
      const results = await router.processToolCalls([parsed]);

      const result = single(results);
      expect(result.data).toEqual({
        error: "Error: intentional failure",
        recovered: true,
      });
    });

    it("onPostToolUseFailure can suppress error", async () => {
      const router = createToolRouter({
        tools: makeTools(),
        threadId: "t1",
        appendToolResult: noopAppend,
        hooks: {
          onPostToolUseFailure: () => ({ suppress: true }),
        },
      });

      const parsed = router.parseToolCall({
        id: "tc1",
        name: "Fail",
        args: {},
      });
      const results = await router.processToolCalls([parsed]);

      expect(single(results).data).toEqual(
        expect.objectContaining({ suppressed: true })
      );
    });
  });

  describe("per-tool hooks", () => {
    it("per-tool onPreToolUse can skip", async () => {
      const append = vi.fn(async () => {});
      const tools = {
        Echo: {
          ...echoTool(),
          hooks: { onPreToolUse: () => ({ skip: true }) },
        },
      } satisfies ToolMap;

      const router = createToolRouter({
        tools,
        threadId: "t1",
        appendToolResult: append,
      });

      const parsed = router.parseToolCall({
        id: "tc1",
        name: "Echo",
        args: { message: "hi" },
      });
      const results = await router.processToolCalls([parsed]);

      expect(results).toHaveLength(0);
    });
  });

  describe("filterByName", () => {
    it("filters calls by name", () => {
      const router = createToolRouter({
        tools: makeTools(),
        threadId: "t1",
        appendToolResult: noopAppend,
      });

      const echoCall = router.parseToolCall({
        id: "tc1",
        name: "Echo",
        args: { message: "a" },
      });
      const failCall = router.parseToolCall({
        id: "tc2",
        name: "Fail",
        args: {},
      });

      const filtered = router.filterByName([echoCall, failCall], "Echo");
      expect(single(filtered).name).toBe("Echo");
    });
  });

  describe("hasToolCall", () => {
    it("returns true when a call matches", () => {
      const router = createToolRouter({
        tools: makeTools(),
        threadId: "t1",
        appendToolResult: noopAppend,
      });

      const call = router.parseToolCall({
        id: "tc1",
        name: "Echo",
        args: { message: "a" },
      });
      expect(router.hasToolCall([call], "Echo")).toBe(true);
    });

    it("returns false when no call matches", () => {
      const router = createToolRouter({
        tools: makeTools(),
        threadId: "t1",
        appendToolResult: noopAppend,
      });

      const call = router.parseToolCall({
        id: "tc1",
        name: "Echo",
        args: { message: "a" },
      });
      expect(router.hasToolCall([call], "Fail")).toBe(false);
    });
  });

  describe("getResultsByName", () => {
    it("filters results by name", async () => {
      const router = createToolRouter({
        tools: makeTools(),
        threadId: "t1",
        appendToolResult: noopAppend,
      });

      const p1 = router.parseToolCall({
        id: "tc1",
        name: "Echo",
        args: { message: "a" },
      });

      const allResults = await router.processToolCalls([p1]);
      const echoResults = router.getResultsByName(allResults, "Echo");
      expect(echoResults).toHaveLength(1);

      const failResults = router.getResultsByName(allResults, "Fail");
      expect(failResults).toHaveLength(0);
    });
  });

  describe("processToolCallsByName", () => {
    it("processes only matching calls with custom handler", async () => {
      const append = vi.fn(async () => {});
      const router = createToolRouter({
        tools: makeTools(),
        threadId: "t1",
        appendToolResult: append,
      });

      const echoCall = router.parseToolCall({
        id: "tc1",
        name: "Echo",
        args: { message: "custom" },
      });
      const failCall = router.parseToolCall({
        id: "tc2",
        name: "Fail",
        args: {},
      });

      const results = await router.processToolCallsByName(
        [echoCall, failCall],
        "Echo",
        (args) => ({
          toolResponse: `custom: ${args.message}`,
          data: { custom: true },
        })
      );

      expect(single(results).data).toEqual({ custom: true });
    });
  });

  describe("resultAppended flag", () => {
    it("skips appendToolResult when resultAppended is true", async () => {
      const append = vi.fn(async () => {});
      const tools = {
        Echo: defineTool({
          name: "Echo",
          description: "test",
          schema: z.object({ message: z.string() }),
          handler: (args) => ({
            toolResponse: args.message,
            data: null,
            resultAppended: true,
          }),
        }),
      } satisfies ToolMap;

      const router = createToolRouter({
        tools,
        threadId: "t1",
        appendToolResult: append,
      });

      const parsed = router.parseToolCall({
        id: "tc1",
        name: "Echo",
        args: { message: "test" },
      });
      await router.processToolCalls([parsed]);

      expect(append).not.toHaveBeenCalled();
    });
  });

  describe("skills integration", () => {
    it("adds ReadSkill tool when skills are provided", () => {
      const router = createToolRouter({
        tools: { Echo: echoTool() } satisfies ToolMap,
        threadId: "t1",
        appendToolResult: noopAppend,
        skills: [
          {
            name: "test-skill",
            description: "A test skill",
            instructions: "Do the thing",
          },
        ],
      });

      expect(router.hasTool("ReadSkill")).toBe(true);
    });

    it("does not add ReadSkill when no skills", () => {
      const router = createToolRouter({
        tools: { Echo: echoTool() } satisfies ToolMap,
        threadId: "t1",
        appendToolResult: noopAppend,
      });

      expect(router.hasTool("ReadSkill")).toBe(false);
    });
  });
});

describe("withAutoAppend", () => {
  it("appends result and sets resultAppended", async () => {
    const threadHandler = vi.fn(async () => {});
    const inner = vi.fn(async () => ({
      toolResponse: "large payload",
      data: { summary: "ok" },
    }));

    const wrapped = withAutoAppend(threadHandler, inner);
    const ctx = {
      threadId: "t1",
      toolCallId: "tc1",
      toolName: "Echo",
    };

    const result = await wrapped({ message: "hi" }, ctx);

    expect(threadHandler).toHaveBeenCalledWith({
      threadId: "t1",
      toolCallId: "tc1",
      toolName: "Echo",
      content: "large payload",
    });
    expect(result.resultAppended).toBe(true);
    expect(result.toolResponse).toBe("Response appended via withAutoAppend");
    expect(result.data).toEqual({ summary: "ok" });
  });
});

describe("hasNoOtherToolCalls", () => {
  it("returns true when all calls match excluded name", () => {
    const calls = [
      { id: "1", name: "Echo", args: {} },
      { id: "2", name: "Echo", args: {} },
    ];
    expect(hasNoOtherToolCalls(calls as never[], "Echo" as never)).toBe(true);
  });

  it("returns false when other calls exist", () => {
    const calls = [
      { id: "1", name: "Echo", args: {} },
      { id: "2", name: "Fail", args: {} },
    ];
    expect(hasNoOtherToolCalls(calls as never[], "Echo" as never)).toBe(false);
  });
});
