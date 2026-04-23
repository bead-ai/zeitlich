import { describe, expect, it, vi } from "vitest";
import {
  getThreadListKey,
  getThreadMetaKey,
  THREAD_TTL_SECONDS,
} from "./keys";
import { createThreadManager } from "./manager";

describe("thread keys (public helpers)", () => {
  it("getThreadListKey matches the internal list-key format", () => {
    expect(getThreadListKey("messages", "abc")).toBe("messages:thread:abc");
    expect(getThreadListKey("myScope", "xyz")).toBe("myScope:thread:xyz");
  });

  it("getThreadMetaKey matches the internal meta-key format", () => {
    expect(getThreadMetaKey("messages", "abc")).toBe(
      "messages:meta:thread:abc"
    );
    expect(getThreadMetaKey("myScope", "xyz")).toBe("myScope:meta:thread:xyz");
  });

  it("THREAD_TTL_SECONDS is 90 days", () => {
    expect(THREAD_TTL_SECONDS).toBe(60 * 60 * 24 * 90);
  });
});

describe("createThreadManager ↔ public key helpers round-trip", () => {
  it("writes and reads via the exact keys returned by the public helpers", async () => {
    const store = new Map<string, string[]>();
    const meta = new Map<string, string>();

    const writtenListExpires = new Map<string, number>();
    const writtenMetaExpires = new Map<string, number>();

    const redis = {
      exists: vi.fn(async (k: string) => (meta.has(k) ? 1 : 0)),
      set: vi.fn(
        async (k: string, v: string, _ex: string, ttl: number) => {
          meta.set(k, v);
          writtenMetaExpires.set(k, ttl);
          return "OK";
        }
      ),
      del: vi.fn(async (...keys: string[]) => {
        let n = 0;
        for (const k of keys) {
          if (store.delete(k)) n++;
          if (meta.delete(k)) n++;
        }
        return n;
      }),
      rpush: vi.fn(async (k: string, ...values: string[]) => {
        const list = store.get(k) ?? [];
        list.push(...values);
        store.set(k, list);
        return list.length;
      }),
      lrange: vi.fn(async (k: string) => store.get(k) ?? []),
      llen: vi.fn(async (k: string) => (store.get(k) ?? []).length),
      ltrim: vi.fn(async () => "OK"),
      expire: vi.fn(async (k: string, ttl: number) => {
        if (store.has(k)) writtenListExpires.set(k, ttl);
        if (meta.has(k)) writtenMetaExpires.set(k, ttl);
        return 1;
      }),
      eval: vi.fn(async () => 1),
    };

    const threadKey = "messages";
    const threadId = "t1";
    const tm = createThreadManager<{ id: string }>({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      redis: redis as any,
      threadId,
      key: threadKey,
      idOf: (m) => m.id,
    });

    await tm.initialize();

    const expectedList = getThreadListKey(threadKey, threadId);
    const expectedMeta = getThreadMetaKey(threadKey, threadId);

    expect(meta.has(expectedMeta)).toBe(true);
    expect(writtenMetaExpires.get(expectedMeta)).toBe(THREAD_TTL_SECONDS);

    // Append uses rpush (idOf set → eval path; bypass eval for this check by
    // calling rpush path via no-idOf manager)
    const tm2 = createThreadManager<{ id: string }>({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      redis: redis as any,
      threadId,
      key: threadKey,
    });
    await tm2.append([{ id: "m1" }]);

    expect(store.has(expectedList)).toBe(true);
    expect(store.get(expectedList)).toEqual([JSON.stringify({ id: "m1" })]);
    expect(writtenListExpires.get(expectedList)).toBe(THREAD_TTL_SECONDS);
  });
});
