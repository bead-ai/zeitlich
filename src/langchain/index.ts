/**
 * LangChain adapter for Zeitlich.
 *
 * Provides LangChain-specific implementations of the framework-agnostic
 * thread manager, model invoker, and shared activities interfaces.
 *
 * @example
 * ```typescript
 * import {
 *   createLangChainThreadManager,
 *   createLangChainModelInvoker,
 *   createLangChainSharedActivities,
 * } from 'zeitlich/langchain';
 * ```
 */

// Thread manager
export {
  createLangChainThreadManager,
  type LangChainThreadManager,
  type LangChainThreadManagerConfig,
  type LangChainToolMessageContent,
} from "./thread-manager";

// Model invoker
export {
  createLangChainModelInvoker,
  invokeLangChainModel,
  type LangChainModelInvokerConfig,
} from "./model-invoker";

// Shared activities
export { createLangChainSharedActivities } from "./activities";
