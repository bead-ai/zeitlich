/**
 * LangChain adapter for Zeitlich.
 *
 * Provides a unified adapter that bundles thread management and model
 * invocation using LangChain's StoredMessage format.
 *
 * @example
 * ```typescript
 * import {
 *   createLangChainAdapter,
 *   createLangChainThreadManager,
 * } from 'zeitlich/adapters/langchain';
 *
 * const adapter = createLangChainAdapter({ redis, model });
 * ```
 */

// Adapter (primary API)
export {
  createLangChainAdapter,
  type LangChainAdapter,
  type LangChainAdapterConfig,
} from "./activities";

// Thread manager
export {
  createLangChainThreadManager,
  type LangChainThreadManager,
  type LangChainThreadManagerConfig,
  type LangChainToolMessageContent,
} from "./thread-manager";

// Model invoker (for advanced use — prefer adapter.createModelInvoker)
export {
  createLangChainModelInvoker,
  invokeLangChainModel,
  type LangChainModelInvokerConfig,
} from "./model-invoker";
