import { describe, expect, it, beforeEach } from "vitest";
import type Redis from "ioredis";
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
import { createFakeRedis } from "./test-utils";

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
  let redis: Redis & { _store: Map<string, unknown> };

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
  let redis: Redis & { _store: Map<string, unknown> };

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
      await redis.lrange(getThreadListKey("messages", "t-1"), 0, -1)
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
          return async (..._keys: string[]): Promise<number> => {
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
        redis: wrapped as unknown as Redis,
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
    // Pipeline stub that *applies* non-failing commands to the
    // underlying fake (so residue is observable) and errors on rpush
    // — mimicking a partial OOM where the list write fails but the
    // dedup SETs queued after it still land. Without compensating
    // cleanup, those stale dedup keys could silently skip a future
    // append with the same id.
    const wrapped = new Proxy(redis, {
      get(target, prop, receiver): unknown {
        if (prop === "pipeline") {
          return (): Record<string, unknown> => {
            type Op = { method: string; args: unknown[] };
            const ops: Op[] = [];
            const chain: Record<string, unknown> = {};
            for (const m of ["set", "del", "rpush", "expire"]) {
              chain[m] = (...args: unknown[]): Record<string, unknown> => {
                ops.push({ method: m, args });
                return chain;
              };
            }
            chain.exec = async (): Promise<Array<[Error | null, unknown]>> => {
              const out: Array<[Error | null, unknown]> = [];
              const callable = target as unknown as Record<
                string,
                (...a: unknown[]) => Promise<unknown>
              >;
              for (const op of ops) {
                if (op.method === "rpush") {
                  out.push([new Error("OOM"), null]);
                  continue;
                }
                const fn = callable[op.method];
                if (!fn) throw new Error(`stub: unknown ${op.method}`);
                const result = await fn(...op.args);
                out.push([null, result]);
              }
              return out;
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
        redis: wrapped as unknown as Redis,
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
    // Wrap the fake's `pipeline()` so `exec()` returns a tuple list
    // containing a per-command error — mimicking ioredis's behaviour
    // when Redis runtime errors (OOM, ACL, WRONGTYPE) occur inside a
    // pipeline. The top-level promise resolves; the error lives in the
    // result tuple, and applySnapshot must surface it.
    const wrapped = new Proxy(redis, {
      get(target, prop, receiver): unknown {
        if (prop === "pipeline") {
          return (): Record<string, unknown> => {
            type Op = { method: string; args: unknown[] };
            const ops: Op[] = [];
            const chain: Record<string, unknown> = {};
            for (const m of ["set", "del", "rpush", "expire"]) {
              chain[m] = (...args: unknown[]): Record<string, unknown> => {
                ops.push({ method: m, args });
                return chain;
              };
            }
            chain.exec = async (): Promise<Array<[Error | null, unknown]>> =>
              ops.map((op, i) =>
                op.method === "rpush"
                  ? [new Error("OOM command not allowed"), null]
                  : [null, i]
              );
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
        redis: wrapped as unknown as Redis,
        threadKey: "messages",
        threadId: "t-fail",
        snapshot: snap,
      })
    ).rejects.toThrow("OOM command not allowed");

    expect(await redis.exists(getThreadMetaKey("messages", "t-fail"))).toBe(0);
  });

  it("issues a single pipeline.exec() rather than per-key writes", async () => {
    let pipelineCalls = 0;
    const wrapped = new Proxy(redis, {
      get(target, prop, receiver): unknown {
        if (prop === "pipeline") {
          return (): unknown => {
            pipelineCalls++;
            return (target as unknown as { pipeline: () => unknown }).pipeline();
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
      redis: wrapped as unknown as Redis,
      threadKey: "messages",
      threadId: "t-1",
      snapshot: snap,
    });

    expect(pipelineCalls).toBe(1);
  });

  it("clears any partial residue from a previous failed restore", async () => {
    const listKey = getThreadListKey("messages", "t-1");
    const stateKey = getThreadStateKey("messages", "t-1");
    await redis.rpush(listKey, "stale-message");
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
