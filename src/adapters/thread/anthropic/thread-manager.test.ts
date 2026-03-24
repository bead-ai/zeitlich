import { describe, expect, it, vi } from "vitest";
import type { StoredMessage } from "./thread-manager";
import { createAnthropicThreadManager } from "./thread-manager";

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

const systemMsg: StoredMessage = {
  id: "sys-1",
  message: { role: "user", content: "You are helpful." },
  isSystem: true,
};

const userMsg: StoredMessage = {
  id: "msg-1",
  message: { role: "user", content: [{ type: "text", text: "Hello" }] },
};

const assistantMsg: StoredMessage = {
  id: "msg-2",
  message: { role: "assistant", content: [{ type: "text", text: "Hi there!" }] },
};

describe("Anthropic thread manager hooks", () => {
  describe("onPrepareMessage", () => {
    it("transforms stored messages before system extraction and merge", async () => {
      const hook = vi.fn((msg: StoredMessage) => {
        if (msg.isSystem) return msg;
        const firstBlock = (msg.message.content as Array<{ text: string }>)[0];
        return {
          ...msg,
          message: {
            ...msg.message,
            content: [{ type: "text" as const, text: `[modified] ${firstBlock?.text}` }],
          },
        };
      });

      const redis = createMockRedis([systemMsg, userMsg, assistantMsg]);
      const tm = createAnthropicThreadManager({
        redis: redis as never,
        threadId: "t1",
        hooks: { onPrepareMessage: hook },
      });

      const { messages, system } = await tm.prepareForInvocation();

      expect(hook).toHaveBeenCalledTimes(3);
      expect(hook).toHaveBeenCalledWith(systemMsg, 0, [systemMsg, userMsg, assistantMsg]);
      expect(system).toBe("You are helpful.");
      expect(messages[0]?.content).toEqual([{ type: "text", text: "[modified] Hello" }]);
      expect(messages[1]?.content).toEqual([{ type: "text", text: "[modified] Hi there!" }]);
    });

    it("is not called when not configured", async () => {
      const redis = createMockRedis([userMsg]);
      const tm = createAnthropicThreadManager({
        redis: redis as never,
        threadId: "t1",
      });

      const { messages } = await tm.prepareForInvocation();
      expect(messages).toHaveLength(1);
    });
  });

  describe("onPreparedMessage", () => {
    it("transforms SDK-native messages after merge", async () => {
      const hook = vi.fn((msg) => ({
        ...msg,
        content: [{ type: "text" as const, text: "[post] done" }],
      }));

      const redis = createMockRedis([userMsg, assistantMsg]);
      const tm = createAnthropicThreadManager({
        redis: redis as never,
        threadId: "t1",
        hooks: { onPreparedMessage: hook },
      });

      const { messages } = await tm.prepareForInvocation();

      expect(hook).toHaveBeenCalledTimes(2);
      expect(messages[0]?.content).toEqual([{ type: "text", text: "[post] done" }]);
    });

    it("receives the full prepared messages array", async () => {
      const hook = vi.fn((msg) => msg);

      const redis = createMockRedis([userMsg, assistantMsg]);
      const tm = createAnthropicThreadManager({
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

      const redis = createMockRedis([userMsg]);
      const tm = createAnthropicThreadManager({
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
  });
});
