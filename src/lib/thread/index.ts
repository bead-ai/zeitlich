export { createThreadManager } from "./manager";
export { createThreadOpsProxy } from "./proxy";
export {
  THREAD_TTL_SECONDS,
  getThreadListKey,
  getThreadMetaKey,
  getThreadStateKey,
  getThreadDedupKey,
} from "./keys";

export type {
  ThreadManagerConfig,
  BaseThreadManager,
  ProviderThreadManager,
  ThreadManagerHooks,
} from "./types";

// Cold-tier (S3-style) thread archive
export { createS3ColdStore } from "./cold-store";
export type {
  ColdThreadStore,
  ThreadSnapshot,
  S3LikeClient,
  S3ColdStoreConfig,
} from "./cold-store";

// Tiered (Redis hot + pluggable cold) thread manager
export { createTieredThreadManager } from "./tiered";
export type {
  TieredThreadManager,
  TieredThreadManagerConfig,
  FlushOptions,
} from "./tiered";

// Low-level snapshot helpers (advanced — for custom cold stores or
// admin tooling that mirrors zeitlich's hot↔cold transitions).
export {
  encodeSnapshot,
  applySnapshot,
  clearHotTier,
} from "./snapshot";
export type {
  EncodeSnapshotConfig,
  ApplySnapshotConfig,
  ClearHotTierConfig,
} from "./snapshot";
