/**
 * Tiered thread manager: Redis hot tier + pluggable cold tier.
 *
 * Wraps {@link createThreadManager} (Redis-only) and adds two
 * session-boundary operations:
 *
 * - `hydrate()` — when the thread is cold (no meta key in Redis),
 *   restore the latest {@link ThreadSnapshot} from the cold store.
 *   Idempotent; no-op when the thread is already hot or when no
 *   snapshot exists.
 * - `flush({ deleteHot })` — write the current Redis state out to the
 *   cold store as one snapshot, then (by default) `DEL` the hot-tier
 *   keys so idle threads don't sit in Redis memory.
 *
 * All other operations (`append`, `load`, `fork`, `replaceAll`,
 * `truncateFromId`, state I/O) delegate unchanged to the underlying
 * Redis manager, so adapters and tests that use the
 * `BaseThreadManager<T>` interface keep working with zero changes.
 */

import { createThreadManager } from "./manager";
import { THREAD_TTL_SECONDS } from "./keys";
import type { BaseThreadManager, ThreadManagerConfig } from "./types";
import type { ColdThreadStore } from "./cold-store";
import {
  applySnapshot,
  clearHotTier,
  encodeSnapshot,
} from "./snapshot";

/** Configuration for {@link createTieredThreadManager}. */
export interface TieredThreadManagerConfig<T> extends ThreadManagerConfig<T> {
  /**
   * Cold-tier archive. When omitted, `hydrate()` and `flush()` are
   * no-ops and the manager behaves identically to
   * {@link createThreadManager}.
   */
  coldStore?: ColdThreadStore;
}

/** Options for {@link TieredThreadManager.flush}. */
export interface FlushOptions {
  /**
   * Delete the hot-tier Redis keys after a successful cold-tier
   * write. Defaults to `true` when a cold store is configured —
   * Redis is just a cache and a future continue/fork will
   * re-hydrate in a single round-trip.
   *
   * Set to `false` to keep the hot tier warm (useful for tests or
   * for "hot-after-flush" use cases where another session is expected
   * to pick the thread up immediately).
   */
  deleteHot?: boolean;
}

/**
 * Extension of {@link BaseThreadManager} with the two cold-tier
 * lifecycle methods.
 */
export interface TieredThreadManager<T> extends BaseThreadManager<T> {
  /**
   * Restore the latest cold-tier snapshot into Redis when the thread
   * is cold. Idempotent — safe to call from a retried activity.
   */
  hydrate(): Promise<void>;
  /**
   * Write the current Redis state to the cold tier and (optionally)
   * drop the hot-tier keys. Idempotent — last-writer-wins on the
   * cold side.
   */
  flush(opts?: FlushOptions): Promise<void>;
}

/**
 * Build a thread manager backed by Redis (hot) and an optional
 * pluggable cold store. See module docstring for the lifecycle
 * semantics.
 */
export function createTieredThreadManager<T>(
  config: TieredThreadManagerConfig<T>
): TieredThreadManager<T> {
  const {
    redis,
    threadId,
    key = "messages",
    coldStore,
    idOf,
    deserialize = (raw: string): T => JSON.parse(raw) as T,
    ttlSeconds = THREAD_TTL_SECONDS,
  } = config;

  const base = createThreadManager<T>(config);

  // Snapshot-time `idOf` operates on raw Redis strings — we deserialize
  // here and forward to the configured (deserialized) `idOf`.
  const rawIdOf = idOf
    ? (raw: string): string => idOf(deserialize(raw))
    : undefined;

  return Object.assign(base, {
    async hydrate(): Promise<void> {
      if (!coldStore) return;
      const snapshot = await coldStore.read(key, threadId);
      if (!snapshot) return;
      await applySnapshot({
        redis,
        threadKey: key,
        threadId,
        snapshot,
        ttlSeconds,
      });
    },

    async flush(opts?: FlushOptions): Promise<void> {
      if (!coldStore) return;
      const snapshot = await encodeSnapshot({
        redis,
        threadKey: key,
        threadId,
        ...(rawIdOf ? { idOf: rawIdOf } : {}),
      });
      if (!snapshot) return;
      await coldStore.write(key, threadId, snapshot);
      const deleteHot = opts?.deleteHot ?? true;
      if (deleteHot) {
        await clearHotTier({
          redis,
          threadKey: key,
          threadId,
          dedupIds: snapshot.dedupIds,
        });
      }
    },
  });
}
