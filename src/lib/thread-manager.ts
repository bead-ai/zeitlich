import type Redis from "ioredis";

const THREAD_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

/**
 * Lua script for atomic idempotent append.
 * Checks a dedup key; if it exists the message was already appended and we
 * return 0. Otherwise appends all messages to the list, sets TTL on both
 * the list and the dedup key, and returns 1.
 *
 * KEYS[1] = dedup key, KEYS[2] = list key
 * ARGV[1] = TTL seconds, ARGV[2..N] = serialised messages
 */
const APPEND_IDEMPOTENT_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return 0
end
for i = 2, #ARGV do
  redis.call('RPUSH', KEYS[2], ARGV[i])
end
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[1]))
redis.call('SET', KEYS[1], '1', 'EX', tonumber(ARGV[1]))
return 1
`;

function getThreadKey(threadId: string, key: string): string {
  return `thread:${threadId}:${key}`;
}

export interface ThreadManagerConfig<T> {
  redis: Redis;
  threadId: string;
  /** Thread key, defaults to 'messages' */
  key?: string;
  /** Custom serializer, defaults to JSON.stringify */
  serialize?: (message: T) => string;
  /** Custom deserializer, defaults to JSON.parse */
  deserialize?: (raw: string) => T;
  /**
   * Extract a unique id from a message for idempotent appends.
   * When provided, `append` uses an atomic Lua script to skip duplicate writes.
   */
  idOf?: (message: T) => string;
}

/** Generic thread manager for any message type */
export interface BaseThreadManager<T> {
  /** Initialize an empty thread */
  initialize(): Promise<void>;
  /** Load all messages from the thread */
  load(): Promise<T[]>;
  /**
   * Append messages to the thread.
   * When `idOf` is configured, appends are idempotent — retries with the
   * same message ids are atomically skipped via a Redis Lua script.
   */
  append(messages: T[]): Promise<void>;
  /** Delete the thread */
  delete(): Promise<void>;
}

/**
 * Creates a generic thread manager for handling conversation state in Redis.
 * Framework-agnostic — works with any serializable message type.
 */
export function createThreadManager<T>(
  config: ThreadManagerConfig<T>,
): BaseThreadManager<T> {
  const {
    redis,
    threadId,
    key = "messages",
    serialize = (m: T): string => JSON.stringify(m),
    deserialize = (raw: string): T => JSON.parse(raw) as T,
    idOf,
  } = config;
  const redisKey = getThreadKey(threadId, key);
  const metaKey = getThreadKey(threadId, `${key}:meta`);

  async function assertThreadExists(): Promise<void> {
    const exists = await redis.exists(metaKey);
    if (!exists) {
      throw new Error(`Thread "${threadId}" (key: ${key}) does not exist`);
    }
  }

  return {
    async initialize(): Promise<void> {
      await redis.del(redisKey);
      await redis.set(metaKey, "1", "EX", THREAD_TTL_SECONDS);
    },

    async load(): Promise<T[]> {
      await assertThreadExists();
      const data = await redis.lrange(redisKey, 0, -1);
      return data.map(deserialize);
    },

    async append(messages: T[]): Promise<void> {
      if (messages.length === 0) return;
      await assertThreadExists();

      if (idOf) {
        const dedupId = messages.map(idOf).join(":");
        const dedupKey = getThreadKey(threadId, `dedup:${dedupId}`);
        await redis.eval(
          APPEND_IDEMPOTENT_SCRIPT,
          2,
          dedupKey,
          redisKey,
          String(THREAD_TTL_SECONDS),
          ...messages.map(serialize),
        );
      } else {
        await redis.rpush(redisKey, ...messages.map(serialize));
        await redis.expire(redisKey, THREAD_TTL_SECONDS);
      }
    },

    async delete(): Promise<void> {
      await redis.del(redisKey, metaKey);
    },
  };
}
