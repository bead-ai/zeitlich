import { describe, expect, it, vi } from "vitest";
import type { StoredMessage } from "./thread-manager";
import { createAnthropicThreadManager } from "./thread-manager";

// ---------------------------------------------------------------------------
// Stateful in-memory Redis mock sufficient for fork / replaceAll flows.
// Only the commands used by createThreadManager are implemented.
// ---------------------------------------------------------------------------

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
    ltrim: vi.fn(async (key: string, start: number, stop: number) => {
      const list = lists.get(key) ?? [];
      const end = stop === -1 ? list.length : stop + 1;
      lists.set(key, list.slice(start, end));
      return "OK";
    }),
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
    get: vi.fn(async (key: string) => strings.get(key) ?? null),
    expire: vi.fn(async (_key: string, _ttl: number) => 1),
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
    __peek: {
      list: (key: string): string[] => [...(lists.get(key) ?? [])],
      strings,
    },
  };
}

const userMsg: StoredMessage = {
  id: "msg-1",
  message: { role: "user", content: [{ type: "text", text: "Hello" }] },
};

const assistantMsg: StoredMessage = {
  id: "msg-2",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "Hi there!" }],
  },
};

const userMsg2: StoredMessage = {
  id: "msg-3",
  message: { role: "user", content: [{ type: "text", text: "Again please" }] },
};

async function seedSource(
  redis: ReturnType<typeof createStatefulRedis>,
  threadId: string,
  messages: StoredMessage[]
): Promise<void> {
  const tm = createAnthropicThreadManager({
    redis: redis as never,
    threadId,
  });
  await tm.initialize();
  await tm.append(messages);
}

describe("Anthropic fork + transform hooks", () => {
  it("behaves like fork when neither onFork hook is configured", async () => {
    const redis = createStatefulRedis();
    await seedSource(redis, "src", [userMsg, assistantMsg]);

    const tm = createAnthropicThreadManager({
      redis: redis as never,
      threadId: "src",
    });
    const forked = await tm.fork("dst");
    const loaded = await forked.load();

    expect(loaded).toEqual([userMsg, assistantMsg]);

    // Source is untouched
    const srcLoaded = await tm.load();
    expect(srcLoaded).toEqual([userMsg, assistantMsg]);
  });

  it("applies onForkTransform alone as a per-message map", async () => {
    const redis = createStatefulRedis();
    await seedSource(redis, "src", [userMsg, assistantMsg, userMsg2]);

    const calls: Array<{
      idx: number;
      id: string;
      total: number;
    }> = [];
    const onForkTransform = vi.fn(
      (msg: StoredMessage, index: number, messages: readonly StoredMessage[]) => {
        calls.push({ idx: index, id: msg.id, total: messages.length });
        const firstBlock = (msg.message.content as Array<{ text?: string }>)[0];
        return {
          ...msg,
          message: {
            ...msg.message,
            content: [
              {
                type: "text" as const,
                text: `[T${index}] ${firstBlock?.text ?? ""}`,
              },
            ],
          },
        };
      }
    );

    const tm = createAnthropicThreadManager({
      redis: redis as never,
      threadId: "src",
      hooks: { onForkTransform },
    });
    const forked = await tm.fork("dst");
    const loaded = await forked.load();

    expect(onForkTransform).toHaveBeenCalledTimes(3);
    expect(calls).toEqual([
      { idx: 0, id: "msg-1", total: 3 },
      { idx: 1, id: "msg-2", total: 3 },
      { idx: 2, id: "msg-3", total: 3 },
    ]);
    expect(loaded).toHaveLength(3);
    expect(loaded[0]?.message.content).toEqual([
      { type: "text", text: "[T0] Hello" },
    ]);
    expect(loaded[1]?.message.content).toEqual([
      { type: "text", text: "[T1] Hi there!" },
    ]);
    expect(loaded[2]?.message.content).toEqual([
      { type: "text", text: "[T2] Again please" },
    ]);

    // Source is unchanged.
    const srcLoaded = await tm.load();
    expect(srcLoaded.map((m) => m.id)).toEqual(["msg-1", "msg-2", "msg-3"]);
  });

  it("applies onForkPrepareThread alone and may change list length", async () => {
    const redis = createStatefulRedis();
    await seedSource(redis, "src", [userMsg, assistantMsg, userMsg2]);

    const onForkPrepareThread = vi.fn(
      async (messages: readonly StoredMessage[]) =>
        // Drop first message and prepend a summary.
        [
          {
            id: "summary-1",
            message: {
              role: "user" as const,
              content: [{ type: "text" as const, text: "[summary]" }],
            },
          },
          ...messages.slice(1),
        ]
    );

    const tm = createAnthropicThreadManager({
      redis: redis as never,
      threadId: "src",
      hooks: { onForkPrepareThread },
    });
    const forked = await tm.fork("dst");
    const loaded = await forked.load();

    expect(onForkPrepareThread).toHaveBeenCalledTimes(1);
    expect(loaded.map((m) => m.id)).toEqual(["summary-1", "msg-2", "msg-3"]);
  });

  it("runs onForkPrepareThread before onForkTransform and passes prepared list as messages", async () => {
    const redis = createStatefulRedis();
    await seedSource(redis, "src", [userMsg, assistantMsg, userMsg2]);

    const order: string[] = [];
    const indicesSeen: Array<{ idx: number; total: number; id: string }> = [];

    const onForkPrepareThread = vi.fn(
      async (messages: readonly StoredMessage[]) => {
        order.push("prepare");
        // Drop the last message (length changes).
        return messages.slice(0, -1);
      }
    );

    const onForkTransform = vi.fn(
      (
        msg: StoredMessage,
        index: number,
        messages: readonly StoredMessage[]
      ) => {
        order.push("transform");
        indicesSeen.push({ idx: index, total: messages.length, id: msg.id });
        return {
          ...msg,
          message: {
            ...msg.message,
            content: [{ type: "text" as const, text: `[x${index}]` }],
          },
        };
      }
    );

    const tm = createAnthropicThreadManager({
      redis: redis as never,
      threadId: "src",
      hooks: { onForkPrepareThread, onForkTransform },
    });
    const forked = await tm.fork("dst");
    const loaded = await forked.load();

    // prepare runs once, transform once per survivor.
    expect(order).toEqual(["prepare", "transform", "transform"]);
    expect(indicesSeen).toEqual([
      { idx: 0, total: 2, id: "msg-1" },
      { idx: 1, total: 2, id: "msg-2" },
    ]);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]?.message.content).toEqual([{ type: "text", text: "[x0]" }]);
    expect(loaded[1]?.message.content).toEqual([{ type: "text", text: "[x1]" }]);
  });

  it("leaves dedup markers cleared so the transformed thread can accept replays", async () => {
    const redis = createStatefulRedis();
    await seedSource(redis, "src", [userMsg, assistantMsg]);

    const onForkTransform = vi.fn(
      (msg: StoredMessage) => ({
        ...msg,
        message: {
          ...msg.message,
          content: [{ type: "text" as const, text: "[replaced]" }],
        },
      })
    );

    const tm = createAnthropicThreadManager({
      redis: redis as never,
      threadId: "src",
      hooks: { onForkTransform },
    });
    await tm.fork("dst");

    // After replaceAll, dedup markers from the pre-replacement writes must be
    // gone — otherwise an append with the same id would be silently skipped.
    const lingering = Array.from(redis.__peek.strings.keys()).filter((k) =>
      k.startsWith("messages:thread:dst:dedup:")
    );
    expect(lingering).toEqual([]);
  });
});
