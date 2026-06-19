import { describe, expect, it, beforeEach } from "vitest";
import type { RedisClientType as Redis } from "redis";
import { createTieredThreadManager } from "./tiered";
import { createThreadManager } from "./manager";
import {
  getThreadDedupKey,
  getThreadListKey,
  getThreadMetaKey,
  getThreadStateKey,
} from "./keys";
import type { PersistedThreadState } from "../state/types";
import { createFakeRedis, createMemoryColdStore } from "./test-utils";

interface TestMsg {
  id: string;
  text: string;
}

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
  custom: { counter: 7 },
};

function makeTiered(
  redis: Redis,
  threadId: string,
  coldStore?: ReturnType<typeof createMemoryColdStore>,
  ttlSeconds?: number
) {
  return createTieredThreadManager<TestMsg>({
    redis,
    threadId,
    idOf: (m) => m.id,
    ...(coldStore && { coldStore }),
    ...(ttlSeconds !== undefined && { ttlSeconds }),
  });
}

describe("createTieredThreadManager — no cold store", () => {
  it("hydrate is a no-op when no cold store is wired", async () => {
    const redis = createFakeRedis();
    const tm = makeTiered(redis, "t-1");
    await tm.hydrate();
    expect(await redis.exists(getThreadMetaKey("messages", "t-1"))).toBe(0);
  });

  it("flush is a no-op when no cold store is wired", async () => {
    const redis = createFakeRedis();
    const tm = makeTiered(redis, "t-1");
    await tm.initialize();
    await tm.append([{ id: "m1", text: "hello" }]);
    await tm.flush();
    expect(await tm.load()).toEqual([{ id: "m1", text: "hello" }]);
  });

  it("delegates all BaseThreadManager ops to the underlying Redis manager", async () => {
    const redis = createFakeRedis();
    const tm = makeTiered(redis, "t-1");
    await tm.initialize();
    await tm.append([
      { id: "m1", text: "a" },
      { id: "m2", text: "b" },
    ]);
    await tm.saveState(sampleState);

    expect(await tm.length()).toBe(2);
    expect(await tm.loadState()).toEqual(sampleState);
    expect(await tm.load()).toEqual([
      { id: "m1", text: "a" },
      { id: "m2", text: "b" },
    ]);

    await tm.truncateFromId("m2");
    expect(await tm.load()).toEqual([{ id: "m1", text: "a" }]);
  });
});

describe("createTieredThreadManager — with cold store", () => {
  let redis: Redis;
  let cold: ReturnType<typeof createMemoryColdStore>;

  beforeEach(() => {
    redis = createFakeRedis();
    cold = createMemoryColdStore();
  });

  it("flush writes messages + state + dedupIds to the cold store", async () => {
    const tm = makeTiered(redis, "t-1", cold);
    await tm.initialize();
    await tm.append([{ id: "m1", text: "hello" }]);
    await tm.append([{ id: "m2", text: "world" }]);
    await tm.saveState(sampleState);

    await tm.flush({ deleteHot: false });

    const snap = cold._snapshots.get("messages::t-1");
    expect(snap).toBeDefined();
    if (!snap) throw new Error("expected snapshot");
    expect(snap.v).toBe(1);
    expect(snap.messages.map((raw) => JSON.parse(raw) as TestMsg)).toEqual([
      { id: "m1", text: "hello" },
      { id: "m2", text: "world" },
    ]);
    expect(snap.state).toEqual(sampleState);
    expect(snap.dedupIds).toEqual(["m1", "m2"]);
  });

  it("flush is a no-op when the thread is cold (no hot tier present)", async () => {
    const tm = makeTiered(redis, "t-1", cold);
    await tm.flush();
    expect(cold._calls.write).toBe(0);
    expect(cold._snapshots.size).toBe(0);
  });

  it("defaults to deleting the hot tier after a successful flush", async () => {
    const tm = makeTiered(redis, "t-1", cold);
    await tm.initialize();
    await tm.append([{ id: "m1", text: "hello" }]);
    await tm.saveState(sampleState);

    await tm.flush();

    expect(await redis.exists(getThreadListKey("messages", "t-1"))).toBe(0);
    expect(await redis.exists(getThreadMetaKey("messages", "t-1"))).toBe(0);
    expect(await redis.exists(getThreadStateKey("messages", "t-1"))).toBe(0);
    expect(await redis.exists(getThreadDedupKey("t-1", "m1"))).toBe(0);
  });

  it("flush({ deleteHot: false }) leaves the hot tier intact", async () => {
    const tm = makeTiered(redis, "t-1", cold);
    await tm.initialize();
    await tm.append([{ id: "m1", text: "hello" }]);

    await tm.flush({ deleteHot: false });

    expect(await tm.load()).toEqual([{ id: "m1", text: "hello" }]);
  });

  it("hydrate restores messages + state + dedup markers from the cold store", async () => {
    // Seed the cold store via a separate manager instance.
    const seed = makeTiered(redis, "t-1", cold);
    await seed.initialize();
    await seed.append([
      { id: "m1", text: "a" },
      { id: "m2", text: "b" },
    ]);
    await seed.saveState(sampleState);
    await seed.flush(); // archives + drops hot tier

    expect(await redis.exists(getThreadMetaKey("messages", "t-1"))).toBe(0);

    // Restore into a fresh manager on the same Redis.
    const restored = makeTiered(redis, "t-1", cold);
    await restored.hydrate();

    expect(await restored.load()).toEqual([
      { id: "m1", text: "a" },
      { id: "m2", text: "b" },
    ]);
    expect(await restored.loadState()).toEqual(sampleState);

    // Re-append m1 — should be skipped because dedup keys were re-primed.
    await restored.append([{ id: "m1", text: "a" }]);
    expect(await restored.length()).toBe(2);
  });

  it("hydrate is idempotent — no-op when the thread is already hot", async () => {
    const tm = makeTiered(redis, "t-1", cold);
    await tm.initialize();
    await tm.append([{ id: "existing", text: "in redis" }]);

    // Pre-seed the cold store with different content.
    await cold.write("messages", "t-1", {
      v: 1,
      messages: [JSON.stringify({ id: "from-cold", text: "different" })],
      state: sampleState,
      dedupIds: ["from-cold"],
    });

    await tm.hydrate();

    expect(await tm.load()).toEqual([{ id: "existing", text: "in redis" }]);
    // Hot thread: the cold store is never read.
    expect(cold._calls.read).toBe(0);
  });

  it("hydrate is a no-op when nothing is archived in the cold store", async () => {
    const tm = makeTiered(redis, "t-1", cold);
    await tm.hydrate();
    expect(await redis.exists(getThreadMetaKey("messages", "t-1"))).toBe(0);
    expect(cold._calls.read).toBe(1);
  });

  it("flush → hydrate is a full round-trip for an empty thread", async () => {
    const tm = makeTiered(redis, "t-1", cold);
    await tm.initialize();
    await tm.flush();

    const restored = makeTiered(redis, "t-1", cold);
    await restored.hydrate();
    expect(await restored.load()).toEqual([]);
    expect(await restored.length()).toBe(0);
  });

  it("repeated flushes converge (idempotent cold writes)", async () => {
    const tm = makeTiered(redis, "t-1", cold);
    await tm.initialize();
    await tm.append([{ id: "m1", text: "hello" }]);
    await tm.flush({ deleteHot: false });
    await tm.flush({ deleteHot: false });
    expect(cold._calls.write).toBe(2);
    const snap = cold._snapshots.get("messages::t-1");
    if (!snap) throw new Error("expected snapshot");
    expect(snap.messages).toHaveLength(1);
  });

  it("repeated hydrates converge (only the first one writes Redis)", async () => {
    await cold.write("messages", "t-1", {
      v: 1,
      messages: [JSON.stringify({ id: "m1", text: "hello" })],
      state: null,
      dedupIds: ["m1"],
    });
    const tm = makeTiered(redis, "t-1", cold);
    await tm.hydrate();
    await tm.hydrate();
    expect(await tm.load()).toEqual([{ id: "m1", text: "hello" }]);
  });

  it("fork from a hydrated source preserves messages in the new thread", async () => {
    // Archive a source thread into cold storage and drop its hot tier.
    const seed = makeTiered(redis, "src", cold);
    await seed.initialize();
    await seed.append([{ id: "m1", text: "a" }]);
    await seed.append([{ id: "m2", text: "b" }]);
    await seed.flush();

    // Hydrate source (mirrors what session.ts does for mode:"fork")
    // then fork into a new thread on the same Redis.
    const src = makeTiered(redis, "src", cold);
    await src.hydrate();
    await src.fork("forked");

    const target = createThreadManager<TestMsg>({
      redis,
      threadId: "forked",
      idOf: (m) => m.id,
    });
    expect(await target.load()).toEqual([
      { id: "m1", text: "a" },
      { id: "m2", text: "b" },
    ]);
  });

  it("honors a custom ttlSeconds when restoring", async () => {
    await cold.write("messages", "t-1", {
      v: 1,
      messages: [JSON.stringify({ id: "m1", text: "hi" })],
      state: null,
      dedupIds: ["m1"],
    });
    const tm = makeTiered(redis, "t-1", cold, 60);
    await tm.hydrate();
    const ttls = (redis as unknown as { _ttls: Map<string, number> })._ttls;
    expect(ttls.get(getThreadMetaKey("messages", "t-1"))).toBe(60);
    expect(ttls.get(getThreadListKey("messages", "t-1"))).toBe(60);
    expect(ttls.get(getThreadDedupKey("t-1", "m1"))).toBe(60);
  });
});
