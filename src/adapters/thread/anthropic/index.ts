/**
 * Anthropic adapter for Zeitlich.
 *
 * Provides a unified adapter that bundles thread management and model
 * invocation using the `@anthropic-ai/sdk`.
 *
 * @example
 * ```typescript
 * import {
 *   createAnthropicAdapter,
 *   createAnthropicThreadManager,
 * } from 'zeitlich/adapters/thread/anthropic';
 * import Anthropic from '@anthropic-ai/sdk';
 *
 * const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
 * const adapter = createAnthropicAdapter({ redis, client, model: 'claude-sonnet-4-20250514' });
 * ```
 */

// Adapter (primary API)
export {
  createAnthropicAdapter,
  type AnthropicAdapter,
  type AnthropicAdapterConfig,
  type AnthropicThreadOps,
} from "./activities";

// Thread manager
export {
  createAnthropicThreadManager,
  type AnthropicThreadManager,
  type AnthropicThreadManagerConfig,
  type AnthropicContent,
  type AnthropicInvocationPayload,
  type StoredMessage,
} from "./thread-manager";

// Model invoker (for advanced use — prefer adapter.createModelInvoker)
export {
  createAnthropicModelInvoker,
  invokeAnthropicModel,
  type AnthropicModelInvokerConfig,
} from "./model-invoker";
