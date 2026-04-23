/**
 * Public helpers for zeitlich's Redis thread storage layout.
 *
 * These are the exact string-building primitives zeitlich's internal thread
 * manager uses for every adapter. Downstream consumers that need to read a
 * persisted thread (for evaluation, observability, admin tooling, etc.)
 * should use these helpers rather than reconstructing the key layout by
 * hand — the layout is versioned with this module, so upgrading zeitlich
 * keeps the consumer in sync.
 *
 * The layout is adapter-agnostic: every thread adapter stores messages the
 * same way.
 *
 * @example
 * ```typescript
 * import {
 *   getThreadListKey,
 *   getThreadMetaKey,
 *   THREAD_TTL_SECONDS,
 * } from 'zeitlich';
 *
 * const listKey = getThreadListKey('messages', threadId);
 * const metaKey = getThreadMetaKey('messages', threadId);
 * const ttl = await redis.ttl(listKey); // <= THREAD_TTL_SECONDS
 * ```
 */

/**
 * TTL (in seconds) applied to every thread list and thread meta key that
 * zeitlich's {@link createThreadManager} writes. Exposed so downstream
 * consumers can size their Redis retention / query windows to match.
 *
 * Current value: 90 days.
 */
export const THREAD_TTL_SECONDS = 60 * 60 * 24 * 90;

/**
 * Build the Redis list key that holds a thread's serialized messages.
 *
 * Mirrors the exact key used internally by zeitlich's thread manager,
 * so a consumer calling `redis.lrange(getThreadListKey(key, id), 0, -1)`
 * sees the same data the writer wrote.
 *
 * @param threadKey - Thread key (defaults to `"messages"` inside the
 *                    thread manager, but downstream adapters may pass
 *                    their own value).
 * @param threadId  - Thread id as provided to the thread manager.
 */
export function getThreadListKey(
  threadKey: string,
  threadId: string
): string {
  return `${threadKey}:thread:${threadId}`;
}

/**
 * Build the Redis key that stores a thread's existence marker / metadata.
 *
 * Zeitlich treats the presence of this key as "thread has been
 * initialized"; append/load/fork/truncate operations fail when it is
 * missing. Consumers can use it as a cheap existence probe without
 * scanning the message list.
 *
 * @param threadKey - Thread key (defaults to `"messages"` inside the
 *                    thread manager, but downstream adapters may pass
 *                    their own value).
 * @param threadId  - Thread id as provided to the thread manager.
 */
export function getThreadMetaKey(
  threadKey: string,
  threadId: string
): string {
  return `${threadKey}:meta:thread:${threadId}`;
}
