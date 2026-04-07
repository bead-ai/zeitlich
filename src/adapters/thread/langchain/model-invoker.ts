import type Redis from "ioredis";
import type { AgentResponse, ModelInvokerConfig } from "../../../lib/model";
import type { StoredMessage } from "@langchain/core/messages";
import type { AIMessageChunk } from "@langchain/core/messages";
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
 * Internally streams the response and emits Temporal heartbeats on each
 * chunk so that long-running LLM calls remain visible to the scheduler.
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
 * return { runAgent: createRunAgentActivity(client, invoker) };
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
    const stream = await model.stream(messages, {
      runName: agentName,
      runId,
      metadata: { thread_id: `${agentName}-${threadId}`, ...metadata },
      tools: state.tools,
      signal,
    });

    let response: AIMessageChunk | undefined;
    for await (const chunk of stream) {
      response = response ? response.concat(chunk) : chunk;
      heartbeat?.();
    }

    if (!response) {
      throw new Error("LangChain stream ended without producing any chunks");
    }

    const toolCalls = response.tool_calls ?? [];

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
        reasonTokens: response.usage_metadata?.output_token_details?.reasoning,
        cachedWriteTokens:
          response.usage_metadata?.input_token_details?.cache_creation ||
          (response.response_metadata.cacheWriteInputTokens as
            | number
            | undefined),
        cachedReadTokens:
          response.usage_metadata?.input_token_details?.cache_read ||
          (response.response_metadata.cacheReadInputTokens as
            | number
            | undefined),
      },
    };
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
