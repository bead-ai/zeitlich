import { describe, expect, it, beforeEach } from "vitest";
import type { RedisClientType } from "redis";
import {
  applySnapshot,
  clearHotTier,
  encodeSnapshot,
} from "./snapshot";
import { createThreadManager } from "./manager";
import {
  getThreadDedupKey,
  getThreadListKey,
  getThreadMetaKey,
  getThreadStateKey,
} from "./keys";
import type { PersistedThreadState } from "../state/types";
import type { ThreadSnapshot } from "./cold-store";
import { createFakeRedis, makeMultiError } from "./test-utils";

const sampleState: PersistedThreadState = {
  tasks: [
    [
      "t1",
      {
        id: "t1",
        subject: "do thing",
        description: "do it",
        activeForm: "doing",
        status: "pending",
        metadata: {},
        blockedBy: [],
        blocks: [],
      },
    ],
  ],
  custom: { counter: 3 },
};

describe("encodeSnapshot", () => {
  let redis: RedisClientType & { _store: Map<string, unknown> };

  beforeEach(() => {
    redis = createFakeRedis();
  });

  it("returns null when the thread has not been initialized", async () => {
    expect(
      await encodeSnapshot({ redis, threadKey: "messages", threadId: "t-1" })
    ).toBeNull();
  });

  it("captures messages, state, and dedup ids when idOf is provided", async () => {
    const tm = createThreadManager<{ id: string; text: string }>({
      redis,
      threadId: "t-1",
      idOf: (m) => m.id,
    });
    await tm.initialize();
    await tm.append([{ id: "m1", text: "hello" }]);
    await tm.append([{ id: "m2", text: "world" }]);
    await tm.saveState(sampleState);

    const snap = await encodeSnapshot({
      redis,
      threadKey: "messages",
      threadId: "t-1",
      idOf: (raw) => (JSON.parse(raw) as { id: string }).id,
    });

    expect(snap).not.toBeNull();
    if (!snap) throw new Error("expected snapshot");
    expect(snap.v).toBe(1);
    expect(snap.messages.map((raw) => JSON.parse(raw) as { id: string })).toEqual([
      { id: "m1", text: "hello" },
      { id: "m2", text: "world" },
    ]);
    expect(snap.state).toEqual(sampleState);
    expect(snap.dedupIds).toEqual(["m1", "m2"]);
  });

  it("returns an empty dedupIds list when idOf is omitted", async () => {
    const tm = createThreadManager<{ id: string }>({
      redis,
      threadId: "t-1",
      idOf: (m) => m.id,
    });
    await tm.initialize();
    await tm.append([{ id: "m1" }]);

    const snap = await encodeSnapshot({
      redis,
      threadKey: "messages",
      threadId: "t-1",
    });

    expect(snap?.dedupIds).toEqual([]);
  });
});

describe("applySnapshot", () => {
  let redis: RedisClientType & { _store: Map<string, unknown> };

  beforeEach(() => {
    redis = createFakeRedis();
  });

  it("restores messages + state + dedup keys into Redis", async () => {
    const snap: ThreadSnapshot = {
      v: 1,
      messages: [
        JSON.stringify({ id: "m1", text: "hello" }),
        JSON.stringify({ id: "m2", text: "world" }),
      ],
      state: sampleState,
      dedupIds: ["m1", "m2"],
    };
    await applySnapshot({
      redis,
      threadKey: "messages",
      threadId: "t-1",
      snapshot: snap,
    });

    const tm = createThreadManager<{ id: string; text: string }>({
      redis,
      threadId: "t-1",
      idOf: (m) => m.id,
    });
    expect(await tm.load()).toEqual([
      { id: "m1", text: "hello" },
      { id: "m2", text: "world" },
    ]);
    expect(await tm.loadState()).toEqual(sampleState);

    // Re-appending m1 should be deduped because dedup key was re-primed.
    await tm.append([{ id: "m1", text: "hello" }]);
    expect(await tm.length()).toBe(2);
  });

  it("is idempotent when the thread is already hot", async () => {
    const tm = createThreadManager<{ id: string }>({
      redis,
      threadId: "t-1",
      idOf: (m) => m.id,
    });
    await tm.initialize();
    await tm.append([{ id: "existing" }]);

    const snap: ThreadSnapshot = {
      v: 1,
      messages: [JSON.stringify({ id: "from-snapshot" })],
      state: null,
      dedupIds: ["from-snapshot"],
    };
    await applySnapshot({
      redis,
      threadKey: "messages",
      threadId: "t-1",
      snapshot: snap,
    });

    expect(await tm.load()).toEqual([{ id: "existing" }]);
  });

  it("handles an empty snapshot (just sets the meta marker)", async () => {
    const snap: ThreadSnapshot = {
      v: 1,
      messages: [],
      state: null,
      dedupIds: [],
    };
    await applySnapshot({
      redis,
      threadKey: "messages",
      threadId: "t-1",
      snapshot: snap,
    });

    const metaKey = getThreadMetaKey("messages", "t-1");
    expect(await redis.exists(metaKey)).toBe(1);
    expect(
      await redis.lRange(getThreadListKey("messages", "t-1"), 0, -1)
    ).toEqual([]);
  });

  it("throws and writes nothing when the residue-cleanup DEL fails", async () => {
    // Stub `redis.del` to reject (mimicking ACL deny, CROSSSLOT, etc.).
    // The fix guarantees no writes hit the wire when this happens —
    // the queued data writes never run because DEL is awaited
    // outside the pipeline.
    const wrapped = new Proxy(redis, {
      get(target, prop, receiver): unknown {
        if (prop === "del") {
          return async (_keys: string | string[]): Promise<number> => {
            throw new Error("NOPERM: DEL denied by ACL");
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });

    const snap: ThreadSnapshot = {
      v: 1,
      messages: [JSON.stringify({ id: "m1" })],
      state: sampleState,
      dedupIds: ["m1"],
    };
    await expect(
      applySnapshot({
        redis: wrapped as unknown as RedisClientType,
        threadKey: "messages",
        threadId: "t-del-fail",
        snapshot: snap,
      })
    ).rejects.toThrow("NOPERM: DEL denied by ACL");

    // No data writes happened — list, state, meta, and dedup are all
    // still untouched on the underlying store.
    expect(
      await redis.exists(getThreadListKey("messages", "t-del-fail"))
    ).toBe(0);
    expect(
      await redis.exists(getThreadStateKey("messages", "t-del-fail"))
    ).toBe(0);
    expect(
      await redis.exists(getThreadMetaKey("messages", "t-del-fail"))
    ).toBe(0);
    expect(
      await redis.exists(getThreadDedupKey("t-del-fail", "m1"))
    ).toBe(0);
  });

  it("clears list/state/dedup residue when a pipelined write fails partway", async () => {
    // `multi()` stub that *applies* non-failing commands to the
    // underlying fake (so residue is observable) and errors on rPush
    // — mimicking a partial OOM where the list write fails but the
    // dedup SETs queued after it still land. Without compensating
    // cleanup, those stale dedup keys could silently skip a future
    // append with the same id. node-redis rejects `execAsPipeline`
    // with a `MultiErrorReply` carrying per-command errors.
    const wrapped = new Proxy(redis, {
      get(target, prop, receiver): unknown {
        if (prop === "multi") {
          return (): Record<string, unknown> => {
            type Op = { method: string; args: unknown[] };
            const ops: Op[] = [];
            const chain: Record<string, unknown> = {};
            for (const m of ["set", "del", "rPush", "expire"]) {
              chain[m] = (...args: unknown[]): Record<string, unknown> => {
                ops.push({ method: m, args });
                return chain;
              };
            }
            chain.execAsPipeline = async (): Promise<unknown[]> => {
              const replies: unknown[] = [];
              const errorIndexes: number[] = [];
              const callable = target as unknown as Record<
                string,
                (...a: unknown[]) => Promise<unknown>
              >;
              for (const [i, op] of ops.entries()) {
                if (op.method === "rPush") {
                  replies.push(new Error("OOM"));
                  errorIndexes.push(i);
                  continue;
                }
                const fn = callable[op.method];
                if (!fn) throw new Error(`stub: unknown ${op.method}`);
                replies.push(await fn(...op.args));
              }
              throw makeMultiError(replies, errorIndexes);
            };
            return chain;
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });

    const snap: ThreadSnapshot = {
      v: 1,
      messages: [JSON.stringify({ id: "m1" })],
      state: sampleState,
      dedupIds: ["m1", "m2"],
    };
    await expect(
      applySnapshot({
        redis: wrapped as unknown as RedisClientType,
        threadKey: "messages",
        threadId: "t-residue",
        snapshot: snap,
      })
    ).rejects.toThrow("OOM");

    // Every key the failed pipeline touched is cleared on the throw
    // path — no list, state, meta, or dedup residue survives.
    expect(
      await redis.exists(getThreadListKey("messages", "t-residue"))
    ).toBe(0);
    expect(
      await redis.exists(getThreadStateKey("messages", "t-residue"))
    ).toBe(0);
    expect(
      await redis.exists(getThreadMetaKey("messages", "t-residue"))
    ).toBe(0);
    expect(await redis.exists(getThreadDedupKey("t-residue", "m1"))).toBe(0);
    expect(await redis.exists(getThreadDedupKey("t-residue", "m2"))).toBe(0);
  });

  it("throws and leaves the meta key unset when a pipelined command fails", async () => {
    // Wrap the fake's `multi()` so `execAsPipeline()` rejects with a
    // `MultiErrorReply` — mimicking node-redis's behaviour when Redis
    // runtime errors (OOM, ACL, WRONGTYPE) occur inside a pipeline.
    // `applySnapshot` must surface the underlying error.
    const wrapped = new Proxy(redis, {
      get(target, prop, receiver): unknown {
        if (prop === "multi") {
          return (): Record<string, unknown> => {
            type Op = { method: string; args: unknown[] };
            const ops: Op[] = [];
            const chain: Record<string, unknown> = {};
            for (const m of ["set", "del", "rPush", "expire"]) {
              chain[m] = (...args: unknown[]): Record<string, unknown> => {
                ops.push({ method: m, args });
                return chain;
              };
            }
            chain.execAsPipeline = async (): Promise<unknown[]> => {
              const replies: unknown[] = [];
              const errorIndexes: number[] = [];
              ops.forEach((op, i) => {
                if (op.method === "rPush") {
                  replies.push(new Error("OOM command not allowed"));
                  errorIndexes.push(i);
                } else {
                  replies.push(i);
                }
              });
              throw makeMultiError(replies, errorIndexes);
            };
            return chain;
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });

    const snap: ThreadSnapshot = {
      v: 1,
      messages: [JSON.stringify({ id: "m1" })],
      state: sampleState,
      dedupIds: ["m1"],
    };
    await expect(
      applySnapshot({
        redis: wrapped as unknown as RedisClientType,
        threadKey: "messages",
        threadId: "t-fail",
        snapshot: snap,
      })
    ).rejects.toThrow("OOM command not allowed");

    expect(await redis.exists(getThreadMetaKey("messages", "t-fail"))).toBe(0);
  });

  it("issues a single multi().execAsPipeline() rather than per-key writes", async () => {
    let multiCalls = 0;
    const wrapped = new Proxy(redis, {
      get(target, prop, receiver): unknown {
        if (prop === "multi") {
          return (): unknown => {
            multiCalls++;
            return (target as unknown as { multi: () => unknown }).multi();
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });

    const snap: ThreadSnapshot = {
      v: 1,
      messages: Array.from({ length: 10 }, (_, i) =>
        JSON.stringify({ id: `m${i}` })
      ),
      state: sampleState,
      dedupIds: Array.from({ length: 10 }, (_, i) => `m${i}`),
    };
    await applySnapshot({
      redis: wrapped as unknown as RedisClientType,
      threadKey: "messages",
      threadId: "t-1",
      snapshot: snap,
    });

    expect(multiCalls).toBe(1);
  });

  it("clears any partial residue from a previous failed restore", async () => {
    const listKey = getThreadListKey("messages", "t-1");
    const stateKey = getThreadStateKey("messages", "t-1");
    await redis.rPush(listKey, "stale-message");
    await redis.set(stateKey, JSON.stringify({ stale: true }));
    // Note: meta is intentionally absent — simulates a half-written restore.

    const snap: ThreadSnapshot = {
      v: 1,
      messages: [JSON.stringify({ id: "fresh" })],
      state: sampleState,
      dedupIds: ["fresh"],
    };
    await applySnapshot({
      redis,
      threadKey: "messages",
      threadId: "t-1",
      snapshot: snap,
    });

    const tm = createThreadManager<{ id: string }>({
      redis,
      threadId: "t-1",
      idOf: (m) => m.id,
    });
    expect(await tm.load()).toEqual([{ id: "fresh" }]);
    expect(await tm.loadState()).toEqual(sampleState);
  });
});

describe("clearHotTier", () => {
  it("removes list, meta, state, and dedup keys", async () => {
    const redis = createFakeRedis();
    const tm = createThreadManager<{ id: string }>({
      redis,
      threadId: "t-1",
      idOf: (m) => m.id,
    });
    await tm.initialize();
    await tm.append([{ id: "m1" }]);
    await tm.saveState(sampleState);

    await clearHotTier({
      redis,
      threadKey: "messages",
      threadId: "t-1",
      dedupIds: ["m1"],
    });

    expect(await redis.exists(getThreadListKey("messages", "t-1"))).toBe(0);
    expect(await redis.exists(getThreadMetaKey("messages", "t-1"))).toBe(0);
    expect(await redis.exists(getThreadStateKey("messages", "t-1"))).toBe(0);
    expect(await redis.exists(getThreadDedupKey("t-1", "m1"))).toBe(0);
  });
});
