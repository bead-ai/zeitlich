import type Redis from "ioredis";
import type { AgentResponse, ModelInvokerConfig } from "../../../lib/model";
import type { StoredMessage } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  createLangChainThreadManager,
  type LangChainThreadManagerHooks,
} from "./thread-manager";
import { getActivityContext } from "../../../lib/activity";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface LangChainModelInvokerConfig<
  TModel extends BaseChatModel<any> = BaseChatModel<any>,
> {
  redis: Redis;
  model: TModel;
  hooks?: LangChainThreadManagerHooks;
}

/**
 * Creates a LangChain-based model invoker that satisfies the generic
 * `ModelInvoker<StoredMessage>` contract.
 *
 * Uses interval-based Temporal heartbeats during model.invoke() to keep
 * long-running LLM calls visible to the scheduler. LangChain's streaming
 * chunk accumulation is unreliable across providers (e.g. reasoning_content
 * blocks don't merge correctly), so we use invoke() for correctness.
 * The caller is responsible for appending the response to the thread.
 *
 * @example
 * ```typescript
 * import { createLangChainModelInvoker } from 'zeitlich/adapters/thread/langchain';
 * import { createRunAgentActivity } from 'zeitlich';
 * import { ChatAnthropic } from '@langchain/anthropic';
 *
 * const model = new ChatAnthropic({ model: "claude-sonnet-4-6" });
 * const invoker = createLangChainModelInvoker({ redis, model });
 *
 * return { ...createRunAgentActivity(client, invoker, "myAgent") };
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createLangChainModelInvoker<
  TModel extends BaseChatModel<any> = BaseChatModel<any>,
>({ redis, model, hooks }: LangChainModelInvokerConfig<TModel>) {
  return async function invokeLangChainModel(
    config: ModelInvokerConfig
  ): Promise<AgentResponse<StoredMessage>> {
    const { threadId, threadKey, agentName, state, metadata } = config;
    const { heartbeat, signal } = getActivityContext();

    const thread = createLangChainThreadManager({
      redis,
      threadId,
      key: threadKey,
      hooks,
    });
    const runId = uuidv4();

    const { messages } = await thread.prepareForInvocation();

    const heartbeatInterval = heartbeat
      ? setInterval(() => heartbeat(), 30_000)
      : undefined;

    try {
      const response = await model.invoke(messages, {
        runName: agentName,
        runId,
        metadata: { thread_id: `${agentName}-${threadId}`, ...metadata },
        tools: state.tools,
        signal,
      });

      const toolCalls = response.tool_calls ?? [];

      const providerUsage =
        (response.response_metadata?.usage as Record<string, unknown>) ?? {};

      return {
        message: response.toDict(),
        rawToolCalls: toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          args: tc.args,
        })),
        usage: {
          inputTokens: response.usage_metadata?.input_tokens,
          outputTokens: response.usage_metadata?.output_tokens,
          reasonTokens:
            response.usage_metadata?.output_token_details?.reasoning,
          cachedWriteTokens:
            response.usage_metadata?.input_token_details?.cache_creation ||
            (providerUsage.cacheWriteInputTokens as number | undefined),
          cachedReadTokens:
            response.usage_metadata?.input_token_details?.cache_read ||
            (providerUsage.cacheReadInputTokens as number | undefined),
        },
      };
    } finally {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
    }
  };
}

/**
 * Standalone function for one-shot LangChain model invocation.
 * Convenience wrapper around createLangChainModelInvoker for cases where
 * you don't need to reuse the invoker.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function invokeLangChainModel<
  TModel extends BaseChatModel<any> = BaseChatModel<any>,
>({
  redis,
  model,
  hooks,
  config,
}: {
  redis: Redis;
  config: ModelInvokerConfig;
  model: TModel;
  hooks?: LangChainThreadManagerHooks;
}): Promise<AgentResponse<StoredMessage>> {
  const invoker = createLangChainModelInvoker({ redis, model, hooks });
  return invoker(config);
}
