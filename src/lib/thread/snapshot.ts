/**
 * Pure Redis I/O helpers for moving a thread between the hot tier
 * (Redis lists + meta + state + dedup markers) and the cold tier
 * (a single {@link ThreadSnapshot} blob in a {@link ColdThreadStore}).
 *
 * These helpers know nothing about S3 or the adapter-specific message
 * envelope — they operate on the raw Redis representation. The
 * tiered thread manager in `tiered.ts` is the only consumer.
 */

import type { RedisClientType } from "redis";
import type { PersistedThreadState } from "../state/types";
import type { ThreadSnapshot } from "./cold-store";
import {
  THREAD_TTL_SECONDS,
  getThreadDedupKey,
  getThreadListKey,
  getThreadMetaKey,
  getThreadStateKey,
} from "./keys";

/** Inputs shared by every snapshot operation. */
interface SnapshotCommon {
  redis: RedisClientType;
  threadKey: string;
  threadId: string;
}

/** Configuration for {@link encodeSnapshot}. */
export interface EncodeSnapshotConfig extends SnapshotCommon {
  /**
   * Extract a dedup id from each raw-serialized message currently in
   * the thread's Redis list. When omitted, the resulting snapshot has
   * an empty `dedupIds` array — idempotency guarantees are best-effort
   * once a thread crosses the hot/cold boundary.
   */
  idOf?: (raw: string) => string;
}

/**
 * Build a {@link ThreadSnapshot} from the current hot-tier state.
 *
 * Returns `null` when no thread exists in the hot tier (the meta key
 * is absent) — callers should treat that as "nothing to flush".
 */
export async function encodeSnapshot(
  config: EncodeSnapshotConfig
): Promise<ThreadSnapshot | null> {
  const { redis, threadKey, threadId, idOf } = config;
  const metaKey = getThreadMetaKey(threadKey, threadId);
  if ((await redis.exists(metaKey)) === 0) {
    return null;
  }
  const listKey = getThreadListKey(threadKey, threadId);
  const stateKey = getThreadStateKey(threadKey, threadId);
  const messages = await redis.lRange(listKey, 0, -1);
  const stateRaw = await redis.get(stateKey);
  const state =
    stateRaw == null ? null : (JSON.parse(stateRaw) as PersistedThreadState);
  const dedupIds = idOf ? messages.map(idOf) : [];
  return { v: 1, messages, state, dedupIds };
}

/** Configuration for {@link applySnapshot}. */
export interface ApplySnapshotConfig extends SnapshotCommon {
  snapshot: ThreadSnapshot;
  /** TTL applied to every Redis key. Defaults to {@link THREAD_TTL_SECONDS}. */
  ttlSeconds?: number;
}

/**
 * Restore a {@link ThreadSnapshot} into the hot tier.
 *
 * Idempotent — if the meta key already exists the thread is already
 * hot and this is a no-op. The meta key is written **last** so a
 * crash mid-restore leaves the thread cold (`load` / `append` will
 * see "thread does not exist") and the next session's hydrate retries
 * cleanly.
 */
export async function applySnapshot(
  config: ApplySnapshotConfig
): Promise<void> {
  const {
    redis,
    threadKey,
    threadId,
    snapshot,
    ttlSeconds = THREAD_TTL_SECONDS,
  } = config;
  const metaKey = getThreadMetaKey(threadKey, threadId);
  if ((await redis.exists(metaKey)) === 1) {
    return;
  }
  const listKey = getThreadListKey(threadKey, threadId);
  const stateKey = getThreadStateKey(threadKey, threadId);

  // Clear partial residue from any prior half-restored attempt.
  // Awaited *outside* the pipeline so a DEL failure (ACL deny,
  // CROSSSLOT, …) short-circuits before any writes hit the wire —
  // pipelines are non-atomic, so a queued DEL wouldn't stop later
  // commands from accumulating data behind a missing meta marker.
  await redis.del([listKey, stateKey]);

  // Pipeline the data writes (list/state/dedup) in one round-trip via a
  // non-transactional `MULTI` (`execAsPipeline`). Meta is written
  // separately, only after every queued command succeeded, preserving
  // the "meta-last" crash-safety invariant — a partial restore must
  // leave meta absent so the next hydrate retries cleanly.
  const pipeline = redis.multi();
  if (snapshot.messages.length > 0) {
    pipeline.rPush(listKey, snapshot.messages);
    pipeline.expire(listKey, ttlSeconds);
  }
  if (snapshot.state != null) {
    pipeline.set(stateKey, JSON.stringify(snapshot.state), { EX: ttlSeconds });
  }
  for (const id of snapshot.dedupIds) {
    pipeline.set(getThreadDedupKey(threadId, id), "1", { EX: ttlSeconds });
  }
  try {
    await pipeline.execAsPipeline();
  } catch (err) {
    // Compensate: pipelines are non-atomic, so writes queued after a
    // failing command (notably dedup SETs) may have landed. Best-effort
    // clear every key we touched so a leftover dedup marker can't
    // silently skip a future append with the same id. node-redis
    // surfaces per-command failures by rejecting `execAsPipeline` with a
    // `MultiErrorReply`; we unwrap it to rethrow the first real error.
    await redis
      .del([
        listKey,
        stateKey,
        ...snapshot.dedupIds.map((id) => getThreadDedupKey(threadId, id)),
      ])
      .catch(() => undefined);
    throw firstPipelineError(err);
  }
  await redis.set(metaKey, "1", { EX: ttlSeconds });
}

/**
 * Unwrap node-redis's `MultiErrorReply` (thrown by `execAsPipeline` when
 * one or more queued commands fail) to the first underlying error so
 * callers see the actual Redis error (OOM, WRONGTYPE, …) rather than the
 * generic aggregate wrapper. The structural check avoids a hard runtime
 * dependency on the `redis` error class.
 */
function firstPipelineError(err: unknown): unknown {
  if (
    err != null &&
    typeof err === "object" &&
    "replies" in err &&
    Array.isArray((err as { replies: unknown }).replies)
  ) {
    const firstErr = (err as { replies: unknown[] }).replies.find(
      (r): r is Error => r instanceof Error
    );
    if (firstErr) return firstErr;
  }
  return err;
}

/** Configuration for {@link clearHotTier}. */
export interface ClearHotTierConfig extends SnapshotCommon {
  /** Dedup ids to delete alongside the list / meta / state keys. */
  dedupIds?: string[];
}

/**
 * Delete every Redis key the thread manager wrote for `(threadKey,
 * threadId)`. Used by the tiered manager's `flush({ deleteHot: true })`
 * to drop hot-tier memory after a successful archive write.
 */
export async function clearHotTier(
  config: ClearHotTierConfig
): Promise<void> {
  const { redis, threadKey, threadId, dedupIds = [] } = config;
  const keys = [
    getThreadListKey(threadKey, threadId),
    getThreadMetaKey(threadKey, threadId),
    getThreadStateKey(threadKey, threadId),
    ...dedupIds.map((id) => getThreadDedupKey(threadId, id)),
  ];
  await redis.del(keys);
}
