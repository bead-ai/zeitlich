import type Redis from "ioredis";
import type { ToolResultConfig } from "../../../lib/types";
import type { PersistedThreadState } from "../../../lib/state/types";
import type { MessageContent } from "@langchain/core/messages";
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
import type { StoredMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  createLangChainThreadManager,
  type LangChainContent,
  type LangChainSystemContent,
  type LangChainThreadManagerHooks,
} from "./thread-manager";
import { createLangChainModelInvoker } from "./model-invoker";
import { ADAPTER_ID } from "./adapter-id";

export type LangChainThreadOps<TScope extends string = ""> = PrefixedThreadOps<
  ScopedPrefix<TScope, typeof ADAPTER_ID>,
  LangChainContent
>;

export interface LangChainAdapterConfig {
  redis: Redis;
  /** Optional default model — if omitted, use `createModelInvoker()` to create invokers later */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model?: BaseChatModel<any>;
  hooks?: LangChainThreadManagerHooks;
}

/**
 * Tool response type accepted by the LangChain adapter.
 *
 * Content is passed directly to `ToolMessage` as `MessageContent`.
 * Handlers can return a string or an array of content blocks
 * (e.g. `{ type: "text", text: "..." }`, `{ type: "image_url", image_url: { ... } }`).
 */
export type LangChainToolResponse = MessageContent;

export interface LangChainAdapter {
  /** Model invoker using the default model (only available when `model` was provided) */
  invoker: ModelInvoker<StoredMessage>;
  /** Create an invoker for a specific model (for multi-model setups) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createModelInvoker(model: BaseChatModel<any>): ModelInvoker<StoredMessage>;
  /**
   * Create prefixed thread activities for registration on the worker.
   *
   * @param scope - Workflow name appended to the adapter prefix.
   *
   * @example
   * ```typescript
   * adapter.createActivities("codingAgent")
   * // → { langChainCodingAgentInitializeThread, langChainCodingAgentAppendHumanMessage, … }
   * ```
   */
  createActivities<S extends string = "">(scope?: S): LangChainThreadOps<S>;

  /**
   * Identity wrapper that types a tool handler for this adapter.
   * Constrains `toolResponse` to {@link LangChainToolResponse}.
   */
  wrapHandler<TArgs, TResult, TContext extends RouterContext = RouterContext>(
    handler: (
      args: TArgs,
      context: TContext
    ) => Promise<ToolHandlerResponse<TResult, LangChainToolResponse>>
  ): ActivityToolHandler<TArgs, TResult, TContext, LangChainToolResponse>;
}

/**
 * Creates a LangChain adapter that bundles thread operations and model
 * invocation using a consistent message format (StoredMessage).
 *
 * Use `createActivities(scope)` to register scoped thread operations as
 * Temporal activities on the worker. The `invoker` (or invokers created via
 * `createModelInvoker`) should be wrapped with `createRunAgentActivity`.
 *
 * @example
 * ```typescript
 * import { createLangChainAdapter } from 'zeitlich/adapters/thread/langchain';
 * import { createRunAgentActivity } from 'zeitlich';
 *
 * const adapter = createLangChainAdapter({ redis, model });
 *
 * export function createActivities(client: WorkflowClient) {
 *   return {
 *     ...adapter.createActivities("codingAgent"),
 *     ...createRunAgentActivity(client, adapter.invoker, "codingAgent"),
 *   };
 * }
 * ```
 *
 * @example Multi-agent worker
 * ```typescript
 * export function createActivities(client: WorkflowClient) {
 *   return {
 *     ...adapter.createActivities("codingAgent"),
 *     ...adapter.createActivities("researchAgent"),
 *     ...createRunAgentActivity(client, adapter.invoker, "codingAgent"),
 *     ...createRunAgentActivity(client, adapter.createModelInvoker(claude), "researchAgent"),
 *   };
 * }
 * ```
 */
export function createLangChainAdapter(
  config: LangChainAdapterConfig
): LangChainAdapter {
  const { redis } = config;

  const threadOps: ThreadOps<LangChainContent> = {
    async initializeThread(
      threadId: string,
      threadKey?: string
    ): Promise<void> {
      const thread = createLangChainThreadManager({
        redis,
        threadId,
        key: threadKey,
      });
      await thread.initialize();
    },

    async appendHumanMessage(
      threadId: string,
      id: string,
      content: LangChainContent,
      threadKey?: string
    ): Promise<void> {
      const thread = createLangChainThreadManager({
        redis,
        threadId,
        key: threadKey,
      });
      await thread.appendUserMessage(id, content);
    },

    async appendSystemMessage(
      threadId: string,
      id: string,
      content: LangChainSystemContent,
      threadKey?: string
    ): Promise<void> {
      const thread = createLangChainThreadManager({
        redis,
        threadId,
        key: threadKey,
      });
      await thread.appendSystemMessage(id, content);
    },

    async appendToolResult(id: string, cfg: ToolResultConfig): Promise<void> {
      const { threadId, threadKey, toolCallId, content } = cfg;
      const thread = createLangChainThreadManager({
        redis,
        threadId,
        key: threadKey,
      });
      await thread.appendToolResult(id, toolCallId, "", content);
    },

    async appendAgentMessage(
      threadId: string,
      id: string,
      message: StoredMessage,
      threadKey?: string
    ): Promise<void> {
      const thread = createLangChainThreadManager({
        redis,
        threadId,
        key: threadKey,
      });
      const patched = { ...message, data: { ...message.data, id } };
      await thread.append([patched]);
    },

    async forkThread(
      sourceThreadId: string,
      targetThreadId: string,
      threadKey?: string
    ): Promise<void> {
      const thread = createLangChainThreadManager({
        redis,
        threadId: sourceThreadId,
        key: threadKey,
        hooks: config.hooks,
      });
      await thread.fork(targetThreadId);
    },

    async truncateThread(
      threadId: string,
      messageId: string,
      threadKey?: string,
    ): Promise<void> {
      const thread = createLangChainThreadManager({ redis, threadId, key: threadKey });
      await thread.truncateFromId(messageId);
    },

    async loadThreadState(
      threadId: string,
      threadKey?: string
    ): Promise<PersistedThreadState | null> {
      const thread = createLangChainThreadManager({
        redis,
        threadId,
        key: threadKey,
      });
      return thread.loadState();
    },

    async saveThreadState(
      threadId: string,
      state: PersistedThreadState,
      threadKey?: string
    ): Promise<void> {
      const thread = createLangChainThreadManager({
        redis,
        threadId,
        key: threadKey,
      });
      await thread.saveState(state);
    },
  };

  function createActivities<S extends string = "">(
    scope?: S
  ): LangChainThreadOps<S> {
    const prefix = scope
      ? `${ADAPTER_ID}${scope.charAt(0).toUpperCase()}${scope.slice(1)}`
      : ADAPTER_ID;
    const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
    return Object.fromEntries(
      Object.entries(threadOps).map(([k, v]) => [`${prefix}${cap(k)}`, v])
    ) as LangChainThreadOps<S>;
  }

  const makeInvoker = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: BaseChatModel<any>
  ): ModelInvoker<StoredMessage> =>
    createLangChainModelInvoker({ redis, model, hooks: config.hooks });

  const invoker: ModelInvoker<StoredMessage> = config.model
    ? makeInvoker(config.model)
    : () => {
        throw new Error(
          "No default model provided to createLangChainAdapter. " +
            "Either pass `model` in the config or use `createModelInvoker(model)` instead."
        );
      };

  return {
    createActivities,
    invoker,
    createModelInvoker: makeInvoker,
    wrapHandler: (handler) => handler,
  };
}
