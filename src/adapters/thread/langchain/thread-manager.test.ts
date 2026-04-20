import { describe, expect, it, vi } from "vitest";
import {
  HumanMessage,
  AIMessage,
  type StoredMessage,
} from "@langchain/core/messages";
import { createLangChainThreadManager } from "./thread-manager";

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

      const args = hook.mock.calls[0] as unknown as [
        unknown,
        number,
        unknown[],
      ];
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
