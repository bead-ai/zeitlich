/**
 * In-memory fakes used by the thread-storage unit tests.
 *
 * Lives outside `*.test.ts` so multiple test files can share the
 * same fake without copy/pasting. Not exported from the package — kept
 * inside `src/lib/thread` so type imports work and the test runner
 * picks it up directly.
 */

import type { RedisClientType } from "redis";
import type { ColdThreadStore, ThreadSnapshot } from "./cold-store";

type Value = string | string[];

/** node-redis `SetOptions` subset the stub understands. */
interface FakeSetOptions {
  EX?: number;
  NX?: boolean;
  expiration?: { type: "EX" | "PX" | "EXAT" | "PXAT"; value: number } | "KEEPTTL";
  condition?: "NX" | "XX";
}

/** node-redis accepts a single key or an array (`RedisVariadicArgument`). */
type Keys = string | string[];
const toKeys = (keys: Keys): string[] => (Array.isArray(keys) ? keys : [keys]);

/**
 * Minimal in-memory node-redis stub covering the commands the thread
 * manager + snapshot helpers use: get/set/del/exists/expire,
 * lRange/rPush/lLen/lTrim, and the `eval`-based idempotent-append Lua
 * script. Mirrors the node-redis (`redis`) v4+ API surface — camelCase
 * commands, an options object for `set`, variadic-or-array keys for
 * `del`/`exists`, and a `multi().execAsPipeline()` pipeline that rejects
 * with a `MultiErrorReply`-shaped error when a queued command fails.
 * Behaviour matches Redis closely enough for unit tests; TTLs are stored
 * but never expire automatically.
 */
export function createFakeRedis(): RedisClientType & {
  _store: Map<string, Value>;
  _ttls: Map<string, number>;
} {
  const store = new Map<string, Value>();
  const ttls = new Map<string, number>();

  const isList = (k: string): boolean => Array.isArray(store.get(k));
  const ensureList = (k: string): string[] => {
    const v = store.get(k);
    if (v === undefined) {
      const fresh: string[] = [];
      store.set(k, fresh);
      return fresh;
    }
    if (!Array.isArray(v)) throw new Error(`WRONGTYPE: ${k} is not a list`);
    return v;
  };

  const fake = {
    async get(key: string): Promise<string | null> {
      const v = store.get(key);
      if (v === undefined) return null;
      if (Array.isArray(v)) throw new Error(`WRONGTYPE: ${key} is a list`);
      return v;
    },
    async set(
      key: string,
      value: string,
      options?: FakeSetOptions
    ): Promise<"OK" | null> {
      // NX guard: when the condition is NX and the key already exists,
      // Redis returns null. We follow the same contract for tests that
      // need it.
      const nx = options?.NX === true || options?.condition === "NX";
      if (nx && store.has(key)) {
        return null;
      }
      store.set(key, String(value));
      const ttl =
        options?.EX ??
        (options?.expiration && options.expiration !== "KEEPTTL"
          ? options.expiration.value
          : undefined);
      if (typeof ttl === "number") {
        ttls.set(key, ttl);
      }
      return "OK";
    },
    async del(keys: Keys): Promise<number> {
      let removed = 0;
      for (const k of toKeys(keys)) {
        if (store.delete(k)) removed++;
        ttls.delete(k);
      }
      return removed;
    },
    async exists(keys: Keys): Promise<number> {
      return toKeys(keys).reduce((acc, k) => acc + (store.has(k) ? 1 : 0), 0);
    },
    async expire(key: string, ttl: number): Promise<number> {
      if (!store.has(key)) return 0;
      ttls.set(key, ttl);
      return 1;
    },
    async lRange(key: string, start: number, end: number): Promise<string[]> {
      if (!store.has(key)) return [];
      if (!isList(key)) return [];
      const list = store.get(key) as string[];
      const last = end === -1 ? list.length - 1 : end;
      return list.slice(start, last + 1);
    },
    async rPush(key: string, element: Keys): Promise<number> {
      const list = ensureList(key);
      list.push(...toKeys(element));
      return list.length;
    },
    async lLen(key: string): Promise<number> {
      if (!store.has(key)) return 0;
      const list = store.get(key) as string[];
      return list.length;
    },
    async lTrim(key: string, start: number, end: number): Promise<"OK"> {
      if (!store.has(key)) return "OK";
      const list = store.get(key) as string[];
      const last = end === -1 ? list.length - 1 : end;
      store.set(key, list.slice(start, last + 1));
      return "OK";
    },
    async eval(
      _script: string,
      options: { keys?: string[]; arguments?: string[] }
    ): Promise<number> {
      // Mirrors APPEND_IDEMPOTENT_SCRIPT in src/lib/thread/manager.ts.
      const keys = options.keys ?? [];
      const argv = options.arguments ?? [];
      const dedupKey = keys[0];
      const listKey = keys[1];
      const ttl = Number(argv[0]);
      const messages = argv.slice(1);
      if (dedupKey === undefined || listKey === undefined) {
        throw new Error("eval stub: missing keys");
      }
      if (store.has(dedupKey)) return 0;
      const list = ensureList(listKey);
      list.push(...messages);
      ttls.set(listKey, ttl);
      store.set(dedupKey, "1");
      ttls.set(dedupKey, ttl);
      return 1;
    },
    // Chainable `multi()` stub. Defers each command to the underlying
    // sync fake methods on `.execAsPipeline()`, so TTL tracking and store
    // semantics stay identical to the non-pipelined path. Mirrors
    // node-redis: per-command failures reject the pipeline with a
    // `MultiErrorReply`-shaped error (`{ replies, errorIndexes }`).
    multi(): FakeMulti {
      const impl = fake as unknown as {
        set: (
          key: string,
          value: string,
          options?: FakeSetOptions
        ) => Promise<"OK" | null>;
        del: (keys: Keys) => Promise<number>;
        rPush: (key: string, element: Keys) => Promise<number>;
        expire: (key: string, ttl: number) => Promise<number>;
      };
      const ops: Array<() => Promise<unknown>> = [];
      const chain: FakeMulti = {
        set: (key, value, options) => {
          ops.push(() => impl.set(key, value, options));
          return chain;
        },
        del: (keys) => {
          ops.push(() => impl.del(keys));
          return chain;
        },
        rPush: (key, element) => {
          ops.push(() => impl.rPush(key, element));
          return chain;
        },
        expire: (key, ttl) => {
          ops.push(() => impl.expire(key, ttl));
          return chain;
        },
        execAsPipeline: async () => {
          const replies: unknown[] = [];
          const errorIndexes: number[] = [];
          let i = 0;
          for (const op of ops) {
            try {
              replies.push(await op());
            } catch (e) {
              replies.push(e);
              errorIndexes.push(i);
            }
            i++;
          }
          if (errorIndexes.length > 0) {
            throw makeMultiError(replies, errorIndexes);
          }
          return replies;
        },
      };
      return chain;
    },
    _store: store,
    _ttls: ttls,
  } as unknown as RedisClientType & {
    _store: Map<string, Value>;
    _ttls: Map<string, number>;
  };

  return fake;
}

/** Minimal chainable surface used by the fake-redis `multi()` stub. */
interface FakeMulti {
  set: (key: string, value: string, options?: FakeSetOptions) => FakeMulti;
  del: (keys: Keys) => FakeMulti;
  rPush: (key: string, element: Keys) => FakeMulti;
  expire: (key: string, ttl: number) => FakeMulti;
  execAsPipeline: () => Promise<unknown[]>;
}

/**
 * Build a node-redis `MultiErrorReply`-shaped error: an `Error` carrying
 * `replies` (per-command results, with failures as `Error`s) and
 * `errorIndexes`. `applySnapshot` unwraps this to surface the first real
 * error.
 */
export function makeMultiError(
  replies: unknown[],
  errorIndexes: number[]
): Error & { replies: unknown[]; errorIndexes: number[] } {
  return Object.assign(
    new Error(
      `${errorIndexes.length} commands failed, see .replies and .errorIndexes for more information`
    ),
    { replies, errorIndexes }
  );
}

/**
 * In-memory `ColdThreadStore` used by the tiered manager tests. Spies
 * on read/write/delete call counts so tests can assert idempotency
 * and call sequencing.
 */
export function createMemoryColdStore(): ColdThreadStore & {
  _snapshots: Map<string, ThreadSnapshot>;
  _calls: { read: number; write: number; delete: number };
} {
  const snapshots = new Map<string, ThreadSnapshot>();
  const calls = { read: 0, write: 0, delete: 0 };
  const compositeKey = (threadKey: string, threadId: string): string =>
    `${threadKey}::${threadId}`;
  return {
    async read(threadKey: string, threadId: string) {
      calls.read++;
      return snapshots.get(compositeKey(threadKey, threadId)) ?? null;
    },
    async write(threadKey: string, threadId: string, snapshot: ThreadSnapshot) {
      calls.write++;
      // Clone to mirror real-world serialization (S3 round-trips
      // through JSON).
      snapshots.set(
        compositeKey(threadKey, threadId),
        JSON.parse(JSON.stringify(snapshot)) as ThreadSnapshot
      );
    },
    async delete(threadKey: string, threadId: string) {
      calls.delete++;
      snapshots.delete(compositeKey(threadKey, threadId));
    },
    _snapshots: snapshots,
    _calls: calls,
  };
}
