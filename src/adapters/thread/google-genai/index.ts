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

// Adapter (primary API)
export {
  createGoogleGenAIAdapter,
  type GoogleGenAIAdapter,
  type GoogleGenAIAdapterConfig,
  type GoogleGenAIThreadOps,
} from "./activities";

// Thread manager
export {
  createGoogleGenAIThreadManager,
  messageContentToParts,
  type GoogleGenAIThreadManager,
  type GoogleGenAIThreadManagerConfig,
  type StoredContent,
} from "./thread-manager";

// Model invoker (for advanced use — prefer adapter.createModelInvoker)
export {
  createGoogleGenAIModelInvoker,
  invokeGoogleGenAIModel,
  type GoogleGenAIModelInvokerConfig,
} from "./model-invoker";
