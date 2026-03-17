import type Redis from "ioredis";
import type { ToolResultConfig } from "../../../lib/types";
import type { MessageContent } from "@langchain/core/messages";
import type { PrefixedThreadOps } from "../../../lib/session/types";
import type { ModelInvoker } from "../../../lib/model";
import type { StoredMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createLangChainThreadManager } from "./thread-manager";
import { createLangChainModelInvoker } from "./model-invoker";

export type LangChainThreadOps = PrefixedThreadOps<"langChain">;

export interface LangChainAdapterConfig {
  redis: Redis;
  /** Optional default model — if omitted, use `createModelInvoker()` to create invokers later */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model?: BaseChatModel<any>;
}

export interface LangChainAdapter {
  /** Thread operations (register these as Temporal activities on the worker) */
  threadOps: LangChainThreadOps;
  /** Model invoker using the default model (only available when `model` was provided) */
  invoker: ModelInvoker<StoredMessage>;
  /** Create an invoker for a specific model (for multi-model setups) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createModelInvoker(model: BaseChatModel<any>): ModelInvoker<StoredMessage>;
}

/**
 * Creates a LangChain adapter that bundles thread operations and model
 * invocation using a consistent message format (StoredMessage).
 *
 * The returned `threadOps` should be registered as Temporal activities on
 * the worker. The `invoker` (or invokers created via `createModelInvoker`)
 * should be wrapped with `createRunAgentActivity` for per-agent activities.
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
 *     ...adapter.threadOps,
 *     runAgent: createRunAgentActivity(client, adapter.invoker),
 *   };
 * }
 * ```
 *
 * @example Multi-model setup
 * ```typescript
 * const adapter = createLangChainAdapter({ redis });
 *
 * export function createActivities(client: WorkflowClient) {
 *   return {
 *     ...adapter.threadOps,
 *     runResearchAgent: createRunAgentActivity(client, adapter.createModelInvoker(claude)),
 *     runWriterAgent: createRunAgentActivity(client, adapter.createModelInvoker(gpt4)),
 *   };
 * }
 * ```
 */
export function createLangChainAdapter(
  config: LangChainAdapterConfig
): LangChainAdapter {
  const { redis } = config;

  const threadOps: LangChainThreadOps = {
    async langChainInitializeThread(threadId: string): Promise<void> {
      const thread = createLangChainThreadManager({ redis, threadId });
      await thread.initialize();
    },

    async langChainAppendHumanMessage(
      threadId: string,
      id: string,
      content: string | MessageContent
    ): Promise<void> {
      const thread = createLangChainThreadManager({ redis, threadId });
      await thread.appendHumanMessage(id, content);
    },

    async langChainAppendSystemMessage(
      threadId: string,
      id: string,
      content: string
    ): Promise<void> {
      const thread = createLangChainThreadManager({ redis, threadId });
      await thread.appendSystemMessage(id, content);
    },

    async langChainAppendToolResult(id: string, cfg: ToolResultConfig): Promise<void> {
      const { threadId, toolCallId, content } = cfg;
      const thread = createLangChainThreadManager({ redis, threadId });
      await thread.appendToolMessage(id, content, toolCallId);
    },

    async langChainForkThread(
      sourceThreadId: string,
      targetThreadId: string
    ): Promise<void> {
      const thread = createLangChainThreadManager({
        redis,
        threadId: sourceThreadId,
      });
      await thread.fork(targetThreadId);
    },
  };

  const makeInvoker = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: BaseChatModel<any>
  ): ModelInvoker<StoredMessage> =>
    createLangChainModelInvoker({ redis, model });

  const invoker: ModelInvoker<StoredMessage> = config.model
    ? makeInvoker(config.model)
    : () => {
        throw new Error(
          "No default model provided to createLangChainAdapter. " +
            "Either pass `model` in the config or use `createModelInvoker(model)` instead."
        );
      };

  return {
    threadOps,
    invoker,
    createModelInvoker: makeInvoker,
  };
}
