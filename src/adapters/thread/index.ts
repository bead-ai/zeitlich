/**
 * Barrel re-exports for every built-in thread adapter's public identity.
 *
 * Downstream consumers reading persisted threads can import a narrow
 * discriminated union of adapter identifiers without pulling the full
 * adapter implementation (Redis, provider SDKs, etc.) as a dependency —
 * each individual re-export resolves to an `adapter-id.ts` module with
 * no runtime dependencies.
 *
 * @example
 * ```typescript
 * import {
 *   LANGCHAIN_ADAPTER_ID,
 *   GOOGLE_GENAI_ADAPTER_ID,
 *   ANTHROPIC_ADAPTER_ID,
 *   type ThreadAdapterId,
 * } from 'zeitlich/adapters/thread';
 *
 * interface ThreadIdentity {
 *   adapter: ThreadAdapterId;
 *   threadKey: string;
 *   threadId: string;
 * }
 * ```
 */

export { ADAPTER_ID as LANGCHAIN_ADAPTER_ID } from "./langchain/adapter-id";
export { ADAPTER_ID as GOOGLE_GENAI_ADAPTER_ID } from "./google-genai/adapter-id";
export { ADAPTER_ID as ANTHROPIC_ADAPTER_ID } from "./anthropic/adapter-id";

import type { ADAPTER_ID as LANGCHAIN } from "./langchain/adapter-id";
import type { ADAPTER_ID as GOOGLE_GENAI } from "./google-genai/adapter-id";
import type { ADAPTER_ID as ANTHROPIC } from "./anthropic/adapter-id";

/** Narrow discriminated union of every built-in thread adapter id. */
export type ThreadAdapterId =
  | typeof LANGCHAIN
  | typeof GOOGLE_GENAI
  | typeof ANTHROPIC;
