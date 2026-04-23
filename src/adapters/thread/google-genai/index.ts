/**
 * Google GenAI adapter for Zeitlich.
 *
 * Provides a unified adapter that bundles thread management and model
 * invocation using the `@google/genai` SDK (Gemini).
 *
 * @example
 * ```typescript
 * import {
 *   createGoogleGenAIAdapter,
 *   createGoogleGenAIThreadManager,
 * } from 'zeitlich/adapters/thread/google-genai';
 * import { GoogleGenAI } from '@google/genai';
 *
 * const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
 * const adapter = createGoogleGenAIAdapter({ redis, client, model: 'gemini-2.5-flash' });
 * ```
 */

// Adapter identity (wire format — matches Temporal activity-name prefix)
export { ADAPTER_ID, type AdapterId } from "./adapter-id";

// Adapter (primary API)
export {
  createGoogleGenAIAdapter,
  type GoogleGenAIAdapter,
  type GoogleGenAIAdapterConfig,
  type GoogleGenAIThreadOps,
  type GoogleGenAIToolResponse,
} from "./activities";

// Thread manager
export {
  createGoogleGenAIThreadManager,
  type GoogleGenAIThreadManager,
  type GoogleGenAIThreadManagerConfig,
  type GoogleGenAIContent,
  type GoogleGenAIInvocationPayload,
  type StoredContent,
} from "./thread-manager";

// Model invoker (for advanced use — prefer adapter.createModelInvoker)
export {
  createGoogleGenAIModelInvoker,
  invokeGoogleGenAIModel,
  type GoogleGenAIModelInvokerConfig,
} from "./model-invoker";
