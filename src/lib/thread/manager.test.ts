import { describe, expect, it, beforeEach } from "vitest";
import type { RedisClientType } from "redis";
import { createThreadManager } from "./manager";
import type { PersistedThreadState } from "../state/types";

type Keys = string | string[];
const toKeys = (keys: Keys): string[] => (Array.isArray(keys) ? keys : [keys]);

/**
 * Minimal in-memory node-redis stub exposing just the commands used by
 * `createThreadManager`'s state methods (get/set/del/exists/expire) plus
 * the list helpers needed for `initialize`/`fork`. Uses the node-redis
 * (`redis`) camelCase API and array-or-variadic keys.
 */
function createFakeRedis(): RedisClientType {
  const store = new Map<string, string>();

  const redis = {
    async get(key: string): Promise<string | null> {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async set(
      key: string,
      value: string,
      _options?: { EX?: number }
    ): Promise<"OK"> {
      store.set(key, String(value));
      return "OK";
    },
    async del(keys: Keys): Promise<number> {
      let removed = 0;
      for (const k of toKeys(keys)) {
        if (store.delete(k)) removed++;
      }
      return removed;
    },
    async exists(keys: Keys): Promise<number> {
      return toKeys(keys).reduce((acc, k) => acc + (store.has(k) ? 1 : 0), 0);
    },
    async expire(_key: string, _ttl: number): Promise<number> {
      return 1;
    },
    async lRange(): Promise<string[]> {
      return [];
    },
    async rPush(): Promise<number> {
      return 0;
    },
    _store: store,
  } as unknown as RedisClientType & { _store: Map<string, string> };

  return redis;
}

const baseSlice: PersistedThreadState = {
  tasks: [
    [
      "t1",
      {
        id: "t1",
        subject: "do a thing",
        description: "do it",
        activeForm: "doing a thing",
        status: "pending",
        metadata: {},
        blockedBy: [],
        blocks: [],
      },
    ],
  ],
  custom: { counter: 7, label: "hello" },
};

describe("createThreadManager state persistence", () => {
  let redis: RedisClientType & { _store: Map<string, string> };

  beforeEach(() => {
    redis = createFakeRedis() as RedisClientType & {
      _store: Map<string, string>;
    };
  });

  async function initThread(threadId: string): Promise<void> {
    const tm = createThreadManager({ redis, threadId });
    await tm.initialize();
  }

  it("loadState returns null when nothing has been saved", async () => {
    await initThread("thread-1");
    const tm = createThreadManager({ redis, threadId: "thread-1" });
    expect(await tm.loadState()).toBeNull();
  });

  it("saveState writes a round-trippable JSON slice", async () => {
    await initThread("thread-1");
    const tm = createThreadManager({ redis, threadId: "thread-1" });
    await tm.saveState(baseSlice);

    const loaded = await tm.loadState();
    expect(loaded).toEqual(baseSlice);
  });

  it("saveState throws if the thread was never initialized", async () => {
    const tm = createThreadManager({ redis, threadId: "missing" });
    await expect(tm.saveState(baseSlice)).rejects.toThrow(/does not exist/);
  });

  it("fork copies the persisted state slice to the new thread", async () => {
    await initThread("source");
    const src = createThreadManager({ redis, threadId: "source" });
    await src.saveState(baseSlice);

    const dst = await src.fork("target");

    expect(await dst.loadState()).toEqual(baseSlice);
  });

  it("fork leaves the new thread's slice null when source has none", async () => {
    await initThread("source");
    const src = createThreadManager({ redis, threadId: "source" });

    const dst = await src.fork("target");

    expect(await dst.loadState()).toBeNull();
  });

  it("deleteState removes only the state key", async () => {
    await initThread("thread-1");
    const tm = createThreadManager({ redis, threadId: "thread-1" });
    await tm.saveState(baseSlice);

    await tm.deleteState();

    expect(await tm.loadState()).toBeNull();
    const keys = Array.from(redis._store.keys());
    expect(keys.some((k) => k.includes(":meta:"))).toBe(true);
    expect(keys.some((k) => k.includes(":state"))).toBe(false);
  });

  it("delete removes messages + meta + state together", async () => {
    await initThread("thread-1");
    const tm = createThreadManager({ redis, threadId: "thread-1" });
    await tm.saveState(baseSlice);

    await tm.delete();

    expect(redis._store.size).toBe(0);
  });
});
