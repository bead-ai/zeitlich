import type { ThreadManagerConfig, BaseThreadManager } from "./types";

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
  return `${key}:thread:${threadId}`;
}

/**
 * Creates a generic thread manager for handling conversation state in Redis.
 * Framework-agnostic — works with any serializable message type.
 */
export function createThreadManager<T>(
  config: ThreadManagerConfig<T>
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
          ...messages.map(serialize)
        );
      } else {
        await redis.rpush(redisKey, ...messages.map(serialize));
        await redis.expire(redisKey, THREAD_TTL_SECONDS);
      }
    },

    async fork(newThreadId: string): Promise<BaseThreadManager<T>> {
      await assertThreadExists();
      const data = await redis.lrange(redisKey, 0, -1);
      const forked = createThreadManager({
        ...config,
        threadId: newThreadId,
      });
      await forked.initialize();
      if (data.length > 0) {
        const newKey = getThreadKey(newThreadId, key);
        await redis.rpush(newKey, ...data);
        await redis.expire(newKey, THREAD_TTL_SECONDS);
      }
      return forked;
    },

    async delete(): Promise<void> {
      await redis.del(redisKey, metaKey);
    },

    async length(): Promise<number> {
      await assertThreadExists();
      return redis.llen(redisKey);
    },

    async truncateFromId(messageId: string): Promise<void> {
      await assertThreadExists();
      if (!idOf) {
        throw new Error(
          "truncateFromId requires the thread manager to be configured with `idOf`"
        );
      }
      const data = await redis.lrange(redisKey, 0, -1);
      let idx = -1;
      const removedIds: string[] = [];
      for (let i = 0; i < data.length; i++) {
        const raw = data[i];
        if (raw === undefined) continue;
        const id = idOf(deserialize(raw));
        if (idx === -1 && id === messageId) idx = i;
        if (idx !== -1) removedIds.push(id);
      }
      if (idx === -1) return;
      if (idx === 0) {
        await redis.del(redisKey);
        await redis.expire(metaKey, THREAD_TTL_SECONDS);
      } else {
        await redis.ltrim(redisKey, 0, idx - 1);
        await redis.expire(redisKey, THREAD_TTL_SECONDS);
      }
      // Clear dedup markers for the removed messages so that a rewind
      // retry which reuses the same ids (e.g. the same assistantId) can
      // re-append without the idempotent-append Lua script treating it
      // as a duplicate.
      if (removedIds.length > 0) {
        await redis.del(
          ...removedIds.map((id) => getThreadKey(threadId, `dedup:${id}`))
        );
      }
    },
  };
}
