import { describe, expect, it, vi } from "vitest";
import type { StoredContent } from "./thread-manager";
import { createGoogleGenAIThreadManager } from "./thread-manager";

function createStatefulRedis() {
  const lists = new Map<string, string[]>();
  const strings = new Map<string, string>();

  return {
    exists: vi.fn(async (...keys: string[]) =>
      keys.reduce(
        (acc, k) => acc + (lists.has(k) || strings.has(k) ? 1 : 0),
        0
      )
    ),
    lrange: vi.fn(async (key: string, start: number, stop: number) => {
      const list = lists.get(key) ?? [];
      const end = stop === -1 ? list.length : stop + 1;
      return list.slice(start, end);
    }),
    rpush: vi.fn(async (key: string, ...values: string[]) => {
      const list = lists.get(key) ?? [];
      list.push(...values);
      lists.set(key, list);
      return list.length;
    }),
    ltrim: vi.fn(async () => "OK"),
    del: vi.fn(async (...keys: string[]) => {
      let removed = 0;
      for (const k of keys) {
        if (lists.delete(k)) removed++;
        if (strings.delete(k)) removed++;
      }
      return removed;
    }),
    set: vi.fn(async (key: string, value: string) => {
      strings.set(key, value);
      return "OK";
    }),
    expire: vi.fn(async () => 1),
    llen: vi.fn(async (key: string) => (lists.get(key) ?? []).length),
    eval: vi.fn(
      async (_script: string, _numKeys: number, ...args: string[]) => {
        const [dedupKey, listKey, , ...serialised] = args;
        if (!dedupKey || !listKey) return 0;
        if (strings.has(dedupKey)) return 0;
        const list = lists.get(listKey) ?? [];
        list.push(...serialised);
        lists.set(listKey, list);
        strings.set(dedupKey, "1");
        return 1;
      }
    ),
  };
}

const userContent: StoredContent = {
  id: "msg-1",
  content: { role: "user", parts: [{ text: "Hello" }] },
};

const modelContent: StoredContent = {
  id: "msg-2",
  content: { role: "model", parts: [{ text: "Hi there!" }] },
};

const userContent2: StoredContent = {
  id: "msg-3",
  content: { role: "user", parts: [{ text: "Again please" }] },
};

async function seed(
  redis: ReturnType<typeof createStatefulRedis>,
  threadId: string,
  messages: StoredContent[]
): Promise<void> {
  const tm = createGoogleGenAIThreadManager({
    redis: redis as never,
    threadId,
  });
  await tm.initialize();
  await tm.append(messages);
}

describe("Google GenAI fork + transform hooks", () => {
  it("falls back to plain fork when no hooks are set", async () => {
    const redis = createStatefulRedis();
    await seed(redis, "src", [userContent, modelContent]);

    const tm = createGoogleGenAIThreadManager({
      redis: redis as never,
      threadId: "src",
    });
    const forked = await tm.fork("dst");
    expect(await forked.load()).toEqual([userContent, modelContent]);
  });

  it("applies onForkPrepareThread then onForkTransform in order", async () => {
    const redis = createStatefulRedis();
    await seed(redis, "src", [userContent, modelContent, userContent2]);

    const order: string[] = [];
    const tm = createGoogleGenAIThreadManager({
      redis: redis as never,
      threadId: "src",
      hooks: {
        onForkPrepareThread: async (messages) => {
          order.push("prepare");
          return messages.slice(0, -1);
        },
        onForkTransform: (msg, i) => {
          order.push("transform");
          return {
            ...msg,
            content: { ...msg.content, parts: [{ text: `[x${i}]` }] },
          };
        },
      },
    });

    const forked = await tm.fork("dst");
    const loaded = await forked.load();

    expect(order).toEqual(["prepare", "transform", "transform"]);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]?.content.parts).toEqual([{ text: "[x0]" }]);
    expect(loaded[1]?.content.parts).toEqual([{ text: "[x1]" }]);
  });

  it("keeps the source thread untouched", async () => {
    const redis = createStatefulRedis();
    await seed(redis, "src", [userContent, modelContent]);

    const tm = createGoogleGenAIThreadManager({
      redis: redis as never,
      threadId: "src",
      hooks: {
        onForkTransform: (msg) => ({
          ...msg,
          content: { ...msg.content, parts: [{ text: "mutated" }] },
        }),
      },
    });

    await tm.fork("dst");
    expect(await tm.load()).toEqual([userContent, modelContent]);
  });
});
