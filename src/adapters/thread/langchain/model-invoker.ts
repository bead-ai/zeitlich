import type Redis from "ioredis";
import type { AgentResponse } from "../../../lib/model";
import type { ModelInvokerConfig } from "../../../lib/model";
import { mapStoredMessagesToChatMessages } from "@langchain/core/messages";
import type { StoredMessage } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";
import type {
  BaseChatModel,
  BaseChatModelCallOptions,
  BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import { createLangChainThreadManager } from "./thread-manager";

export interface LangChainModelInvokerConfig {
  redis: Redis;
  model: BaseChatModel<BaseChatModelCallOptions & { tools?: BindToolsInput }>;
}

/**
 * Creates a LangChain-based model invoker that satisfies the generic
 * `ModelInvoker<StoredMessage>` contract.
 *
 * Loads the conversation thread from Redis, invokes a LangChain chat model,
 * appends the AI response, and returns a normalised AgentResponse.
 *
 * @example
 * ```typescript
 * import { createLangChainModelInvoker } from 'zeitlich/adapters/thread/langchain';
 * import { withParentWorkflowState } from 'zeitlich';
 * import { ChatAnthropic } from '@langchain/anthropic';
 *
 * const model = new ChatAnthropic({ model: "claude-sonnet-4-6" });
 * const invoker = createLangChainModelInvoker({ redis, model });
 *
 * // Wrap with withParentWorkflowState to use as runAgent activity:
 * return { runAgent: withParentWorkflowState(client, invoker) };
 * ```
 */
export function createLangChainModelInvoker({
  redis,
  model,
}: LangChainModelInvokerConfig) {
  return async function invokeLangChainModel(
    config: ModelInvokerConfig
  ): Promise<AgentResponse<StoredMessage>> {
    const { threadId, agentName, state, metadata } = config;

    const thread = createLangChainThreadManager({ redis, threadId });
    const runId = uuidv4();

    const messages = await thread.load();
    const response = await model.invoke(
      [...mapStoredMessagesToChatMessages(messages)],
      {
        runName: agentName,
        runId,
        metadata: { thread_id: `${agentName}-${threadId}`, ...metadata },
        tools: state.tools,
      }
    );

    await thread.append([response.toDict()]);

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
          response.usage_metadata?.input_token_details?.cache_creation,
        cachedReadTokens:
          response.usage_metadata?.input_token_details?.cache_read,
      },
    };
  };
}

/**
 * Standalone function for one-shot LangChain model invocation.
 * Convenience wrapper around createLangChainModelInvoker for cases where
 * you don't need to reuse the invoker.
 */
export async function invokeLangChainModel({
  redis,
  model,
  config,
}: {
  redis: Redis;
  config: ModelInvokerConfig;
  model: BaseChatModel<BaseChatModelCallOptions & { tools?: BindToolsInput }>;
}): Promise<AgentResponse<StoredMessage>> {
  const invoker = createLangChainModelInvoker({ redis, model });
  return invoker(config);
}
