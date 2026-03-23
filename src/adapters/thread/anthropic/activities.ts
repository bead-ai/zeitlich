import type Redis from "ioredis";
import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResultConfig } from "../../../lib/types";
import type {
  ThreadOps,
  PrefixedThreadOps,
  ScopedPrefix,
} from "../../../lib/session/types";
import type { ModelInvoker } from "../../../lib/model";
import {
  createAnthropicThreadManager,
  type AnthropicContent,
} from "./thread-manager";
import {
  createAnthropicModelInvoker,
  type AnthropicModelInvokerConfig,
} from "./model-invoker";

const ADAPTER_PREFIX = "anthropic" as const;

export type AnthropicThreadOps<TScope extends string = ""> =
  PrefixedThreadOps<ScopedPrefix<TScope, typeof ADAPTER_PREFIX>, AnthropicContent>;

export interface AnthropicAdapterConfig {
  redis: Redis;
  client: Anthropic;
  /** Default model name (e.g. 'claude-sonnet-4-20250514'). If omitted, use `createModelInvoker()` */
  model?: string;
  /** Maximum tokens to generate. Defaults to 16384. */
  maxTokens?: number;
}

export interface AnthropicAdapter {
  /** Model invoker using the default model (only available when `model` was provided) */
  invoker: ModelInvoker<Anthropic.Messages.Message>;
  /** Create an invoker for a specific model name (for multi-model setups) */
  createModelInvoker(
    model: string,
    maxTokens?: number,
  ): ModelInvoker<Anthropic.Messages.Message>;
  /**
   * Create prefixed thread activities for registration on the worker.
   *
   * @param scope - Workflow name appended to the adapter prefix.
   *   Use different scopes for the main agent vs subagents to avoid collisions.
   *
   * @example
   * ```typescript
   * adapter.createActivities("codingAgent")
   * // → { anthropicCodingAgentInitializeThread, anthropicCodingAgentAppendHumanMessage, … }
   *
   * adapter.createActivities("researchAgent")
   * // → { anthropicResearchAgentInitializeThread, … }
   * ```
   */
  createActivities<S extends string = "">(
    scope?: S,
  ): AnthropicThreadOps<S>;
}

/**
 * Creates an Anthropic adapter that bundles thread operations and model
 * invocation using the `@anthropic-ai/sdk`.
 *
 * Use `createActivities(scope)` to register scoped thread operations as
 * Temporal activities on the worker. The `invoker` (or invokers created via
 * `createModelInvoker`) should be wrapped with `createRunAgentActivity`.
 *
 * @example
 * ```typescript
 * import { createAnthropicAdapter } from 'zeitlich/adapters/thread/anthropic';
 * import { createRunAgentActivity } from 'zeitlich';
 * import Anthropic from '@anthropic-ai/sdk';
 *
 * const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
 * const adapter = createAnthropicAdapter({ redis, client, model: 'claude-sonnet-4-20250514' });
 *
 * export function createActivities(temporalClient: WorkflowClient) {
 *   return {
 *     ...adapter.createActivities("codingAgent"),
 *     runCodingAgent: createRunAgentActivity(temporalClient, adapter.invoker),
 *   };
 * }
 * ```
 *
 * @example Multi-agent worker (main + subagent share the adapter)
 * ```typescript
 * export function createActivities(temporalClient: WorkflowClient) {
 *   return {
 *     ...adapter.createActivities("codingAgent"),
 *     ...adapter.createActivities("researchAgent"),
 *     runCodingAgent: createRunAgentActivity(temporalClient, adapter.invoker),
 *     runResearchAgent: createRunAgentActivity(
 *       temporalClient,
 *       adapter.createModelInvoker('claude-sonnet-4-20250514'),
 *     ),
 *   };
 * }
 * ```
 */
export function createAnthropicAdapter(
  config: AnthropicAdapterConfig,
): AnthropicAdapter {
  const { redis, client } = config;

  const threadOps: ThreadOps<AnthropicContent> = {
    async initializeThread(threadId: string): Promise<void> {
      const thread = createAnthropicThreadManager({ redis, threadId });
      await thread.initialize();
    },

    async appendHumanMessage(
      threadId: string,
      id: string,
      content: AnthropicContent,
    ): Promise<void> {
      const thread = createAnthropicThreadManager({ redis, threadId });
      await thread.appendUserMessage(id, content);
    },

    async appendSystemMessage(
      threadId: string,
      id: string,
      content: string,
    ): Promise<void> {
      const thread = createAnthropicThreadManager({ redis, threadId });
      await thread.appendSystemMessage(id, content);
    },

    async appendToolResult(id: string, cfg: ToolResultConfig): Promise<void> {
      const { threadId, toolCallId, toolName, content } = cfg;
      const thread = createAnthropicThreadManager({ redis, threadId });
      await thread.appendToolResult(id, toolCallId, toolName, content);
    },

    async forkThread(
      sourceThreadId: string,
      targetThreadId: string,
    ): Promise<void> {
      const thread = createAnthropicThreadManager({
        redis,
        threadId: sourceThreadId,
      });
      await thread.fork(targetThreadId);
    },
  };

  function createActivities<S extends string = "">(
    scope?: S,
  ): AnthropicThreadOps<S> {
    const prefix = scope
      ? `${ADAPTER_PREFIX}${scope.charAt(0).toUpperCase()}${scope.slice(1)}`
      : ADAPTER_PREFIX;
    const cap = (s: string): string =>
      s.charAt(0).toUpperCase() + s.slice(1);
    return Object.fromEntries(
      Object.entries(threadOps).map(([k, v]) => [`${prefix}${cap(k)}`, v]),
    ) as AnthropicThreadOps<S>;
  }

  const makeInvoker = (
    model: string,
    maxTokens?: number,
  ): ModelInvoker<Anthropic.Messages.Message> => {
    const invokerConfig: AnthropicModelInvokerConfig = {
      redis,
      client,
      model,
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(config.maxTokens !== undefined && maxTokens === undefined
        ? { maxTokens: config.maxTokens }
        : {}),
    };
    return createAnthropicModelInvoker(invokerConfig);
  };

  const invoker: ModelInvoker<Anthropic.Messages.Message> = config.model
    ? makeInvoker(config.model)
    : ((() => {
        throw new Error(
          "No default model provided to createAnthropicAdapter. " +
            "Either pass `model` in the config or use `createModelInvoker(model)` instead.",
        );
      }) as unknown as ModelInvoker<Anthropic.Messages.Message>);

  return {
    createActivities,
    invoker,
    createModelInvoker: makeInvoker,
  };
}
