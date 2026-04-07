import type Redis from "ioredis";
import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResultConfig } from "../../../lib/types";
import type {
  ActivityToolHandler,
  RouterContext,
  ToolHandlerResponse,
} from "../../../lib/tool-router/types";
import type {
  ThreadOps,
  PrefixedThreadOps,
  ScopedPrefix,
} from "../../../lib/session/types";
import type { ModelInvoker } from "../../../lib/model";
import {
  createAnthropicThreadManager,
  type AnthropicContent,
  type AnthropicThreadManagerHooks,
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
  hooks?: AnthropicThreadManagerHooks;
}

/**
 * Tool response type accepted by the Anthropic adapter.
 *
 * Handlers can return:
 * - **`string`** — plain text content for the tool result.
 * - **`Anthropic.Messages.ToolResultBlockParam["content"]`** — array of content blocks
 *   (e.g. `{ type: "text", text: "..." }`, `{ type: "image", source: { ... } }`).
 *   Passed through as-is to the `tool_result` block.
 */
export type AnthropicToolResponse = Anthropic.Messages.ToolResultBlockParam["content"];

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

  /**
   * Identity wrapper that types a tool handler for this adapter.
   * Constrains `toolResponse` to {@link AnthropicToolResponse}.
   */
  wrapHandler<TArgs, TResult, TContext extends RouterContext = RouterContext>(
    handler: (
      args: TArgs,
      context: TContext,
    ) => Promise<ToolHandlerResponse<TResult, AnthropicToolResponse>>,
  ): ActivityToolHandler<TArgs, TResult, TContext, AnthropicToolResponse>;
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
 *     ...createRunAgentActivity(temporalClient, adapter.invoker, "codingAgent"),
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
 *     ...createRunAgentActivity(temporalClient, adapter.invoker, "codingAgent"),
 *     ...createRunAgentActivity(
 *       temporalClient,
 *       adapter.createModelInvoker('claude-sonnet-4-20250514'),
 *       "researchAgent",
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
    async initializeThread(threadId: string, threadKey?: string): Promise<void> {
      const thread = createAnthropicThreadManager({ redis, threadId, key: threadKey });
      await thread.initialize();
    },

    async appendHumanMessage(
      threadId: string,
      id: string,
      content: AnthropicContent,
      threadKey?: string,
    ): Promise<void> {
      const thread = createAnthropicThreadManager({ redis, threadId, key: threadKey });
      await thread.appendUserMessage(id, content);
    },

    async appendSystemMessage(
      threadId: string,
      id: string,
      content: string,
      threadKey?: string,
    ): Promise<void> {
      const thread = createAnthropicThreadManager({ redis, threadId, key: threadKey });
      await thread.appendSystemMessage(id, content);
    },

    async appendToolResult(id: string, cfg: ToolResultConfig): Promise<void> {
      const { threadId, threadKey, toolCallId, toolName, content } = cfg;
      const thread = createAnthropicThreadManager({ redis, threadId, key: threadKey });
      await thread.appendToolResult(id, toolCallId, toolName, content);
    },

    async appendAgentMessage(
      threadId: string,
      id: string,
      message: Anthropic.Messages.Message,
      threadKey?: string,
    ): Promise<void> {
      const thread = createAnthropicThreadManager({ redis, threadId, key: threadKey });
      await thread.appendAssistantMessage(id, message.content);
    },

    async forkThread(
      sourceThreadId: string,
      targetThreadId: string,
      threadKey?: string,
    ): Promise<void> {
      const thread = createAnthropicThreadManager({
        redis,
        threadId: sourceThreadId,
        key: threadKey,
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
      hooks: config.hooks,
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
    wrapHandler: (handler) => handler,
  };
}
