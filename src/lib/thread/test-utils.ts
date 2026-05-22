/**
 * In-memory fakes used by the thread-storage unit tests.
 *
 * Lives outside `*.test.ts` so multiple test files can share the
 * same fake without copy/pasting. Not exported from the package — kept
 * inside `src/lib/thread` so type imports work and the test runner
 * picks it up directly.
 */

import type Redis from "ioredis";
import type { ColdThreadStore, ThreadSnapshot } from "./cold-store";

type Value = string | string[];

/**
 * Minimal in-memory Redis stub covering the commands the thread
 * manager + snapshot helpers use: get/set/del/exists/expire,
 * lrange/rpush/llen/ltrim, and the `eval`-based idempotent-append Lua
 * script. Behaviour matches Redis closely enough for unit tests; TTLs
 * are stored but never expire automatically.
 */
export function createFakeRedis(): Redis & {
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
      ..._rest: (string | number)[]
    ): Promise<"OK"> {
      // NX guard: when the args contain "NX" and the key already exists,
      // Redis returns null. We follow the same contract for tests that
      // need it; existing call sites use this for compare-and-set.
      const rest = _rest.map((x) => (typeof x === "string" ? x.toUpperCase() : x));
      if (rest.includes("NX") && store.has(key)) {
        return null as unknown as "OK";
      }
      store.set(key, String(value));
      const exIdx = rest.indexOf("EX");
      if (exIdx >= 0 && typeof _rest[exIdx + 1] === "number") {
        ttls.set(key, _rest[exIdx + 1] as number);
      }
      return "OK";
    },
    async del(...keys: string[]): Promise<number> {
      let removed = 0;
      for (const k of keys) {
        if (store.delete(k)) removed++;
        ttls.delete(k);
      }
      return removed;
    },
    async exists(...keys: string[]): Promise<number> {
      return keys.reduce((acc, k) => acc + (store.has(k) ? 1 : 0), 0);
    },
    async expire(key: string, ttl: number): Promise<number> {
      if (!store.has(key)) return 0;
      ttls.set(key, ttl);
      return 1;
    },
    async lrange(key: string, start: number, end: number): Promise<string[]> {
      if (!store.has(key)) return [];
      if (!isList(key)) return [];
      const list = store.get(key) as string[];
      const last = end === -1 ? list.length - 1 : end;
      return list.slice(start, last + 1);
    },
    async rpush(key: string, ...values: string[]): Promise<number> {
      const list = ensureList(key);
      list.push(...values);
      return list.length;
    },
    async llen(key: string): Promise<number> {
      if (!store.has(key)) return 0;
      const list = store.get(key) as string[];
      return list.length;
    },
    async ltrim(key: string, start: number, end: number): Promise<"OK"> {
      if (!store.has(key)) return "OK";
      const list = store.get(key) as string[];
      const last = end === -1 ? list.length - 1 : end;
      store.set(key, list.slice(start, last + 1));
      return "OK";
    },
    async eval(
      _script: string,
      numKeys: number,
      ...args: (string | number)[]
    ): Promise<number> {
      // Mirrors APPEND_IDEMPOTENT_SCRIPT in src/lib/thread/manager.ts.
      const keys = args.slice(0, numKeys) as string[];
      const argv = args.slice(numKeys) as string[];
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
    // Chainable pipeline stub. Defers each command to the underlying
    // sync fake methods on `.exec()`, so TTL tracking and store
    // semantics stay identical to the non-pipelined path. `fake` is
    // typed as `Redis` after the cast below, so we narrow it back to
    // the concrete impl shape here to avoid Redis's callback overloads.
    pipeline(): FakePipeline {
      const impl = fake as unknown as {
        set: (key: string, value: string, ...rest: (string | number)[]) => Promise<"OK">;
        del: (...keys: string[]) => Promise<number>;
        rpush: (key: string, ...values: string[]) => Promise<number>;
        expire: (key: string, ttl: number) => Promise<number>;
      };
      const ops: Array<() => Promise<unknown>> = [];
      const chain: FakePipeline = {
        set: (...args) => {
          const [key, value, ...rest] = args as [string, string, ...(string | number)[]];
          ops.push(() => impl.set(key, value, ...rest));
          return chain;
        },
        del: (...keys) => {
          ops.push(() => impl.del(...keys));
          return chain;
        },
        rpush: (key, ...values) => {
          ops.push(() => impl.rpush(key, ...values));
          return chain;
        },
        expire: (key, ttl) => {
          ops.push(() => impl.expire(key, ttl));
          return chain;
        },
        exec: async () => {
          const results: Array<[Error | null, unknown]> = [];
          for (const op of ops) {
            try {
              results.push([null, await op()]);
            } catch (e) {
              results.push([e as Error, null]);
            }
          }
          return results;
        },
      };
      return chain;
    },
    _store: store,
    _ttls: ttls,
  } as unknown as Redis & {
    _store: Map<string, Value>;
    _ttls: Map<string, number>;
  };

  return fake;
}

/** Minimal chainable surface used by the fake-redis pipeline stub. */
interface FakePipeline {
  set: (...args: (string | number)[]) => FakePipeline;
  del: (...keys: string[]) => FakePipeline;
  rpush: (key: string, ...values: string[]) => FakePipeline;
  expire: (key: string, ttl: number) => FakePipeline;
  exec: () => Promise<Array<[Error | null, unknown]>>;
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
