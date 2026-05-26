import type Redis from "ioredis";
import type { AgentResponse, ModelInvokerConfig } from "../../../lib/model";
import type { AIMessageChunk, StoredMessage } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  createLangChainThreadManager,
  type LangChainThreadManagerHooks,
} from "./thread-manager";
import { getActivityContext } from "../../../lib/activity";

 
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
 * Streams the LLM response and heartbeats Temporal on every chunk,
 * then concatenates into a single AIMessageChunk for downstream use.
 * Note: LangChain's chunk concatenation is unreliable for provider-specific
 * content blocks (e.g. Anthropic reasoning/thinking blocks don't merge
 * correctly) — safe here because we only consume text, tool_calls, and
 * usage_metadata, all of which concat correctly.
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
 
export function createLangChainModelInvoker<
  TModel extends BaseChatModel<any> = BaseChatModel<any>,
>({ redis, model, hooks }: LangChainModelInvokerConfig<TModel>) {
  return async function invokeLangChainModel(
    config: ModelInvokerConfig
  ): Promise<AgentResponse<StoredMessage>> {
    const { threadId, threadKey, agentName, state, metadata, assistantMessageId } =
      config;
    const { heartbeat, signal } = getActivityContext();

    const thread = createLangChainThreadManager({
      redis,
      threadId,
      key: threadKey,
      hooks,
    });
    const runId = uuidv4();

    // Truncate the thread starting at the id the assistant message
    // will be stored under. No-op on the first attempt; on rewind
    // retry / Temporal reset it wipes the prior attempt's assistant
    // + tool results so the LLM sees the original pre-call state.
    await thread.truncateFromId(assistantMessageId);
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
      heartbeat?.();
      response = response ? response.concat(chunk) : chunk;
    }

    if (!response) {
      throw new Error("Model returned an empty stream");
    }

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
  };
}

/**
 * Standalone function for one-shot LangChain model invocation.
 * Convenience wrapper around createLangChainModelInvoker for cases where
 * you don't need to reuse the invoker.
 */
 
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
