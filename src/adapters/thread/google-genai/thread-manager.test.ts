import { describe, expect, it, vi } from "vitest";
import type { Content } from "@google/genai";
import type { StoredContent } from "./thread-manager";
import { createGoogleGenAIThreadManager } from "./thread-manager";

function createMockRedis(stored: StoredContent[]) {
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

const systemContent: StoredContent = {
  id: "sys-1",
  content: { role: "system", parts: [{ text: "You are helpful." }] },
};

const userContent: StoredContent = {
  id: "msg-1",
  content: { role: "user", parts: [{ text: "Hello" }] },
};

const modelContent: StoredContent = {
  id: "msg-2",
  content: { role: "model", parts: [{ text: "Hi there!" }] },
};

describe("Google GenAI thread manager hooks", () => {
  describe("onPrepareMessage", () => {
    it("transforms stored messages before system extraction and merge", async () => {
      const hook = vi.fn((msg: StoredContent) => {
        if (msg.content.role === "system") return msg;
        return {
          ...msg,
          content: {
            ...msg.content,
            parts: [
              { text: `[modified] ${msg.content.parts?.[0]?.text ?? ""}` },
            ],
          },
        };
      });

      const redis = createMockRedis([systemContent, userContent, modelContent]);
      const tm = createGoogleGenAIThreadManager({
        redis: redis as never,
        threadId: "t1",
        hooks: { onPrepareMessage: hook },
      });

      const { contents, systemInstruction } = await tm.prepareForInvocation();

      expect(hook).toHaveBeenCalledTimes(3);
      expect(hook).toHaveBeenCalledWith(systemContent, 0, [
        systemContent,
        userContent,
        modelContent,
      ]);
      expect(systemInstruction).toEqual([{ text: "You are helpful." }]);
      expect(contents[0]?.parts?.[0]?.text).toBe("[modified] Hello");
      expect(contents[1]?.parts?.[0]?.text).toBe("[modified] Hi there!");
    });

    it("is not called when not configured", async () => {
      const redis = createMockRedis([userContent]);
      const tm = createGoogleGenAIThreadManager({
        redis: redis as never,
        threadId: "t1",
      });

      const { contents } = await tm.prepareForInvocation();
      expect(contents).toHaveLength(1);
      expect(contents[0]?.parts?.[0]?.text).toBe("Hello");
    });
  });

  describe("onPreparedMessage", () => {
    it("transforms SDK-native Content after merge", async () => {
      const hook = vi.fn((msg: Content) => ({
        ...msg,
        parts: [{ text: `[post] ${msg.parts?.[0]?.text ?? ""}` }],
      }));

      const redis = createMockRedis([userContent, modelContent]);
      const tm = createGoogleGenAIThreadManager({
        redis: redis as never,
        threadId: "t1",
        hooks: { onPreparedMessage: hook },
      });

      const { contents } = await tm.prepareForInvocation();

      expect(hook).toHaveBeenCalledTimes(2);
      expect(contents[0]?.parts?.[0]?.text).toBe("[post] Hello");
      expect(contents[1]?.parts?.[0]?.text).toBe("[post] Hi there!");
    });

    it("receives the full prepared contents array", async () => {
      const hook = vi.fn((msg: Content) => msg);

      const redis = createMockRedis([userContent, modelContent]);
      const tm = createGoogleGenAIThreadManager({
        redis: redis as never,
        threadId: "t1",
        hooks: { onPreparedMessage: hook },
      });

      await tm.prepareForInvocation();

      const args = hook.mock.calls[0] as unknown as [
        Content,
        number,
        Content[],
      ];
      expect(args[2]).toHaveLength(2);
    });
  });

  describe("both hooks combined", () => {
    it("runs onPrepareMessage before onPreparedMessage", async () => {
      const order: string[] = [];

      const redis = createMockRedis([userContent]);
      const tm = createGoogleGenAIThreadManager({
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
      const redis = createMockRedis([userContent]);
      const tm = createGoogleGenAIThreadManager({
        redis: redis as never,
        threadId: "t1",
        hooks: {
          onPrepareMessage: (msg) => ({
            ...msg,
            content: { ...msg.content, parts: [{ text: "replaced" }] },
          }),
          onPreparedMessage: (msg) => {
            expect(msg.parts?.[0]?.text).toBe("replaced");
            return msg;
          },
        },
      });

      const { contents } = await tm.prepareForInvocation();
      expect(contents[0]?.parts?.[0]?.text).toBe("replaced");
    });
  });
});
