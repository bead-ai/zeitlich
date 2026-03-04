import type Redis from "ioredis";
import type {
  AgentResponse,
  SerializableToolDefinition,
} from "../lib/types";
import type { ModelInvokerConfig } from "../lib/model-invoker";
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
 * import { createLangChainModelInvoker } from 'zeitlich/langchain';
 * import { ChatAnthropic } from '@langchain/anthropic';
 *
 * const model = new ChatAnthropic({ model: "claude-sonnet-4-6" });
 * const invoker = createLangChainModelInvoker({ redis, model });
 *
 * // Use as runAgent activity:
 * const runAgentActivity = (config: RunAgentConfig) =>
 *   invoker({ ...config, tools: config.tools ?? [] });
 * ```
 */
export function createLangChainModelInvoker({
  redis,
  model,
}: LangChainModelInvokerConfig) {
  return async function invokeLangChainModel(
    config: ModelInvokerConfig,
  ): Promise<AgentResponse<StoredMessage>> {
    const { threadId, agentName, tools, metadata } = config;

    const thread = createLangChainThreadManager({ redis, threadId });
    const runId = uuidv4();

    const messages = await thread.load();
    const response = await model.invoke(
      [...mapStoredMessagesToChatMessages(messages)],
      {
        runName: agentName,
        runId,
        metadata: { thread_id: threadId, ...metadata },
        tools: tools as unknown as BindToolsInput,
      },
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
  tools,
  config: { threadId, agentName },
}: {
  redis: Redis;
  tools: SerializableToolDefinition[];
  config: { threadId: string; agentName: string };
  model: BaseChatModel<BaseChatModelCallOptions & { tools?: BindToolsInput }>;
}): Promise<AgentResponse<StoredMessage>> {
  const invoker = createLangChainModelInvoker({ redis, model });
  return invoker({ threadId, agentName, tools });
}
