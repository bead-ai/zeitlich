import { describe, expect, it, vi } from "vitest";
import {
  HumanMessage,
  AIMessage,
  ToolMessage,
  type StoredMessage,
} from "@langchain/core/messages";
import {
  createLangChainThreadManager,
  sanitizeToolCallPairings,
} from "./thread-manager";

function createMockRedis(stored: StoredMessage[]) {
  return {
    exists: vi.fn().mockResolvedValue(1),
    lrange: vi.fn().mockResolvedValue(stored.map((m) => JSON.stringify(m))),
    del: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue("OK"),
    rpush: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    eval: vi.fn().mockResolvedValue(1),
  };
}

const humanMsg = new HumanMessage({ id: "msg-1", content: "Hello" }).toDict();
const aiMsg = new AIMessage({ id: "msg-2", content: "Hi there!" }).toDict();

describe("LangChain thread manager hooks", () => {
  describe("onPrepareMessage", () => {
    it("transforms stored messages before SDK conversion", async () => {
      const hook = vi.fn((msg: StoredMessage) => ({
        ...msg,
        data: { ...msg.data, content: `[modified] ${msg.data.content}` },
      }));

      const redis = createMockRedis([humanMsg, aiMsg]);
      const tm = createLangChainThreadManager({
        redis: redis as never,
        threadId: "t1",
        hooks: { onPrepareMessage: hook },
      });

      const { messages } = await tm.prepareForInvocation();

      expect(hook).toHaveBeenCalledTimes(2);
      expect(hook).toHaveBeenCalledWith(humanMsg, 0, [humanMsg, aiMsg]);
      expect(hook).toHaveBeenCalledWith(aiMsg, 1, [humanMsg, aiMsg]);
      expect(messages[0]?.content).toBe("[modified] Hello");
      expect(messages[1]?.content).toBe("[modified] Hi there!");
    });

    it("is not called when not configured", async () => {
      const redis = createMockRedis([humanMsg]);
      const tm = createLangChainThreadManager({
        redis: redis as never,
        threadId: "t1",
      });

      const { messages } = await tm.prepareForInvocation();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.content).toBe("Hello");
    });
  });

  describe("onPreparedMessage", () => {
    it("transforms SDK-native messages after conversion", async () => {
      const hook = vi.fn((msg) => {
        msg.content = `[post] ${msg.content}`;
        return msg;
      });

      const redis = createMockRedis([humanMsg, aiMsg]);
      const tm = createLangChainThreadManager({
        redis: redis as never,
        threadId: "t1",
        hooks: { onPreparedMessage: hook },
      });

      const { messages } = await tm.prepareForInvocation();

      expect(hook).toHaveBeenCalledTimes(2);
      expect(messages[0]?.content).toBe("[post] Hello");
      expect(messages[1]?.content).toBe("[post] Hi there!");
    });

    it("receives the full prepared messages array", async () => {
      const hook = vi.fn((msg) => msg);

      const redis = createMockRedis([humanMsg, aiMsg]);
      const tm = createLangChainThreadManager({
        redis: redis as never,
        threadId: "t1",
        hooks: { onPreparedMessage: hook },
      });

      await tm.prepareForInvocation();

      const args = hook.mock.calls[0] as unknown as [unknown, number, unknown[]];
      expect(args[2]).toHaveLength(2);
    });
  });

  describe("both hooks combined", () => {
    it("runs onPrepareMessage before onPreparedMessage", async () => {
      const order: string[] = [];

      const redis = createMockRedis([humanMsg]);
      const tm = createLangChainThreadManager({
        redis: redis as never,
        threadId: "t1",
        hooks: {
          onPrepareMessage: (msg) => {
            order.push("pre");
            return msg;
          },
          onPreparedMessage: (msg) => {
            order.push("post");
            return msg;
          },
        },
      });

      await tm.prepareForInvocation();
      expect(order).toEqual(["pre", "post"]);
    });

    it("onPreparedMessage sees results of onPrepareMessage", async () => {
      const redis = createMockRedis([humanMsg]);
      const tm = createLangChainThreadManager({
        redis: redis as never,
        threadId: "t1",
        hooks: {
          onPrepareMessage: (msg) => ({
            ...msg,
            data: { ...msg.data, content: "replaced" },
          }),
          onPreparedMessage: (msg) => {
            expect(msg.content).toBe("replaced");
            return msg;
          },
        },
      });

      const { messages } = await tm.prepareForInvocation();
      expect(messages[0]?.content).toBe("replaced");
    });
  });
});

function aiWithToolCalls(
  id: string,
  toolCalls: Array<{ id: string; name: string; args?: Record<string, unknown> }>,
): StoredMessage {
  return new AIMessage({
    id,
    content: "",
    tool_calls: toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      args: tc.args ?? {},
    })),
  }).toDict();
}

function toolResult(toolCallId: string, content = "ok"): StoredMessage {
  return new ToolMessage({ content, tool_call_id: toolCallId }).toDict();
}

describe("sanitizeToolCallPairings", () => {
  it("returns empty array for empty input", () => {
    expect(sanitizeToolCallPairings([])).toEqual([]);
  });

  it("passes through a healthy thread unchanged", () => {
    const thread: StoredMessage[] = [
      humanMsg,
      aiWithToolCalls("ai-1", [
        { id: "tc-A", name: "search" },
        { id: "tc-B", name: "read" },
      ]),
      toolResult("tc-A"),
      toolResult("tc-B"),
    ];
    const result = sanitizeToolCallPairings(thread);
    expect(result).toHaveLength(4);
  });

  it("injects synthetic result for a missing tool_call_id", () => {
    const thread: StoredMessage[] = [
      humanMsg,
      aiWithToolCalls("ai-1", [
        { id: "tc-A", name: "subagent" },
        { id: "tc-B", name: "media" },
      ]),
      toolResult("tc-B"),
      // tc-A result is missing — next message is a second AI
      aiWithToolCalls("ai-2", [{ id: "tc-C", name: "search" }]),
      toolResult("tc-C"),
    ];
    const result = sanitizeToolCallPairings(thread);

    expect(result).toHaveLength(6);
    const injected = result.at(3);
    expect(injected?.type).toBe("tool");
    expect(injected?.data.tool_call_id).toBe("tc-A");
    expect(injected?.data.content).toContain("activity retried");
  });

  it("reproduces the exact bug scenario from the report", () => {
    const thread: StoredMessage[] = [
      humanMsg,
      // ai_1 with 6 tool calls
      aiWithToolCalls("ai-1", [
        { id: "tc-A", name: "Subagent" },
        { id: "tc-B", name: "MediaGeneration" },
        { id: "tc-C", name: "MediaGeneration" },
        { id: "tc-D", name: "MediaGeneration" },
        { id: "tc-E", name: "MediaGeneration" },
        { id: "tc-F", name: "MediaGeneration" },
      ]),
      // fast results came in before retry
      toolResult("tc-B"),
      toolResult("tc-C"),
      toolResult("tc-D"),
      toolResult("tc-E"),
      toolResult("tc-F"),
      // retry produced ai_2
      aiWithToolCalls("ai-2", [
        { id: "tc-G", name: "Subagent" },
        { id: "tc-H", name: "MediaGeneration" },
      ]),
      // slow Subagent result from ai_1 arrived after ai_2
      toolResult("tc-A"),
    ];

    const result = sanitizeToolCallPairings(thread);

    // ai_1's tool block (index 1) should now be followed by results for all 6 ids
    const ai1Idx = result.findIndex(
      (m) => m.type === "ai" && m.data.id === "ai-1",
    );
    const ai1ToolResults: StoredMessage[] = [];
    for (let i = ai1Idx + 1; i < result.length; i++) {
      const entry = result.at(i);
      if (entry?.type !== "tool") break;
      ai1ToolResults.push(entry);
    }

    const ai1ResultIds = new Set(ai1ToolResults.map((m) => m.data.tool_call_id));
    expect(ai1ResultIds.has("tc-A")).toBe(true);
    expect(ai1ResultIds.has("tc-B")).toBe(true);
    expect(ai1ResultIds.has("tc-C")).toBe(true);
    expect(ai1ResultIds.has("tc-D")).toBe(true);
    expect(ai1ResultIds.has("tc-E")).toBe(true);
    expect(ai1ResultIds.has("tc-F")).toBe(true);

    // ai_2 should still have tc-A (the late arrival) as a separate tool result,
    // but tc-G and tc-H are missing → synthetic results injected
    const ai2Idx = result.findIndex(
      (m) => m.type === "ai" && m.data.id === "ai-2",
    );
    const ai2ToolResults: StoredMessage[] = [];
    for (let i = ai2Idx + 1; i < result.length; i++) {
      const entry = result.at(i);
      if (entry?.type !== "tool") break;
      ai2ToolResults.push(entry);
    }
    const ai2ResultIds = new Set(ai2ToolResults.map((m) => m.data.tool_call_id));
    expect(ai2ResultIds.has("tc-A")).toBe(true);
    expect(ai2ResultIds.has("tc-G")).toBe(true);
    expect(ai2ResultIds.has("tc-H")).toBe(true);
  });

  it("does not inject when all tool_calls have results", () => {
    const thread: StoredMessage[] = [
      aiWithToolCalls("ai-1", [
        { id: "tc-A", name: "foo" },
        { id: "tc-B", name: "bar" },
      ]),
      toolResult("tc-A"),
      toolResult("tc-B"),
    ];
    const result = sanitizeToolCallPairings(thread);
    expect(result).toEqual(thread);
  });

  it("handles AI message with no tool_calls", () => {
    const thread: StoredMessage[] = [humanMsg, aiMsg];
    const result = sanitizeToolCallPairings(thread);
    expect(result).toEqual(thread);
  });

  it("handles multiple consecutive AI messages each missing results", () => {
    const thread: StoredMessage[] = [
      aiWithToolCalls("ai-1", [{ id: "tc-A", name: "foo" }]),
      // no tool results at all
      aiWithToolCalls("ai-2", [{ id: "tc-B", name: "bar" }]),
      // no tool results at all
    ];
    const result = sanitizeToolCallPairings(thread);

    expect(result).toHaveLength(4);
    expect(result.at(1)?.type).toBe("tool");
    expect(result.at(1)?.data.tool_call_id).toBe("tc-A");
    expect(result.at(3)?.type).toBe("tool");
    expect(result.at(3)?.data.tool_call_id).toBe("tc-B");
  });

  it("preserves tool name in synthetic result", () => {
    const thread: StoredMessage[] = [
      aiWithToolCalls("ai-1", [{ id: "tc-A", name: "Subagent" }]),
      aiWithToolCalls("ai-2", [{ id: "tc-B", name: "foo" }]),
      toolResult("tc-B"),
    ];
    const result = sanitizeToolCallPairings(thread);
    const synthetic = result.at(1);
    expect(synthetic?.data.name).toBe("Subagent");
  });

  it("works when AI message is the last message in thread", () => {
    const thread: StoredMessage[] = [
      humanMsg,
      aiWithToolCalls("ai-1", [{ id: "tc-A", name: "foo" }]),
    ];
    const result = sanitizeToolCallPairings(thread);
    expect(result).toHaveLength(3);
    expect(result.at(2)?.type).toBe("tool");
    expect(result.at(2)?.data.tool_call_id).toBe("tc-A");
  });

  it("integrates with prepareForInvocation via thread manager", async () => {
    const thread: StoredMessage[] = [
      humanMsg,
      aiWithToolCalls("ai-1", [
        { id: "tc-A", name: "subagent" },
        { id: "tc-B", name: "read" },
      ]),
      toolResult("tc-B"),
      aiWithToolCalls("ai-2", [{ id: "tc-C", name: "search" }]),
      toolResult("tc-C"),
    ];

    const redis = createMockRedis(thread);
    const tm = createLangChainThreadManager({
      redis: redis as never,
      threadId: "t1",
    });

    const { messages } = await tm.prepareForInvocation();
    const toolMessages = messages.filter((m) => m.getType() === "tool");
    const toolCallIds = toolMessages.map(
      (m) => (m as ToolMessage).tool_call_id,
    );
    expect(toolCallIds).toContain("tc-A");
    expect(toolCallIds).toContain("tc-B");
    expect(toolCallIds).toContain("tc-C");
  });
});
