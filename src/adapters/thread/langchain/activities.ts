import type Redis from "ioredis";
import type { ToolResultConfig } from "../../../lib/types";
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
} from "./thread-manager";
import { createLangChainModelInvoker } from "./model-invoker";

const ADAPTER_PREFIX = "langChain" as const;

export type LangChainThreadOps<TScope extends string = ""> =
  PrefixedThreadOps<ScopedPrefix<TScope, typeof ADAPTER_PREFIX>, LangChainContent>;

export interface LangChainAdapterConfig {
  redis: Redis;
  /** Optional default model — if omitted, use `createModelInvoker()` to create invokers later */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model?: BaseChatModel<any>;
}

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
  createActivities<S extends string = "">(
    scope?: S,
  ): LangChainThreadOps<S>;
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
 *     runCodingAgent: createRunAgentActivity(client, adapter.invoker),
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
 *     runCodingAgent: createRunAgentActivity(client, adapter.invoker),
 *     runResearchAgent: createRunAgentActivity(client, adapter.createModelInvoker(claude)),
 *   };
 * }
 * ```
 */
export function createLangChainAdapter(
  config: LangChainAdapterConfig,
): LangChainAdapter {
  const { redis } = config;

  const threadOps: ThreadOps<LangChainContent> = {
    async initializeThread(threadId: string): Promise<void> {
      const thread = createLangChainThreadManager({ redis, threadId });
      await thread.initialize();
    },

    async appendHumanMessage(
      threadId: string,
      id: string,
      content: LangChainContent,
    ): Promise<void> {
      const thread = createLangChainThreadManager({ redis, threadId });
      await thread.appendUserMessage(id, content);
    },

    async appendSystemMessage(
      threadId: string,
      id: string,
      content: string,
    ): Promise<void> {
      const thread = createLangChainThreadManager({ redis, threadId });
      await thread.appendSystemMessage(id, content);
    },

    async appendToolResult(id: string, cfg: ToolResultConfig): Promise<void> {
      const { threadId, toolCallId, content } = cfg;
      const thread = createLangChainThreadManager({ redis, threadId });
      await thread.appendToolResult(id, toolCallId, "", content);
    },

    async forkThread(
      sourceThreadId: string,
      targetThreadId: string,
    ): Promise<void> {
      const thread = createLangChainThreadManager({
        redis,
        threadId: sourceThreadId,
      });
      await thread.fork(targetThreadId);
    },
  };

  function createActivities<S extends string = "">(
    scope?: S,
  ): LangChainThreadOps<S> {
    const prefix = scope
      ? `${ADAPTER_PREFIX}${scope.charAt(0).toUpperCase()}${scope.slice(1)}`
      : ADAPTER_PREFIX;
    const cap = (s: string): string =>
      s.charAt(0).toUpperCase() + s.slice(1);
    return Object.fromEntries(
      Object.entries(threadOps).map(([k, v]) => [`${prefix}${cap(k)}`, v]),
    ) as LangChainThreadOps<S>;
  }

  const makeInvoker = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: BaseChatModel<any>,
  ): ModelInvoker<StoredMessage> =>
    createLangChainModelInvoker({ redis, model });

  const invoker: ModelInvoker<StoredMessage> = config.model
    ? makeInvoker(config.model)
    : () => {
        throw new Error(
          "No default model provided to createLangChainAdapter. " +
            "Either pass `model` in the config or use `createModelInvoker(model)` instead.",
        );
      };

  return {
    createActivities,
    invoker,
    createModelInvoker: makeInvoker,
  };
}
