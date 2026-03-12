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
} from "./activities";
// Model invoker (for advanced use — prefer adapter.createModelInvoker)
export {
  createGoogleGenAIModelInvoker,
  type GoogleGenAIModelInvokerConfig,
  invokeGoogleGenAIModel,
} from "./model-invoker";
// Thread manager
export {
  createGoogleGenAIThreadManager,
  type GoogleGenAIThreadManager,
  type GoogleGenAIThreadManagerConfig,
  messageContentToParts,
  type StoredContent,
} from "./thread-manager";
