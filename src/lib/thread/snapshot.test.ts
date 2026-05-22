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
