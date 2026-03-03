import type Redis from "ioredis";
import { createThreadManager } from "./thread-manager";
import { type AgentResponse, type SerializableToolDefinition } from "./types";
import { mapStoredMessagesToChatMessages } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";
import type {
  BaseChatModel,
  BaseChatModelCallOptions,
  BindToolsInput,
} from "@langchain/core/language_models/chat_models";

/**
 * Configuration for invoking the model
 */
export interface InvokeModelConfig {
  threadId: string;
  agentName: string;
}

/**
 * Core model invocation logic - shared utility for workflow-specific activities
 *
 * @param options - Named options object
 * @param options.redis - Redis client for thread management
 * @param options.config - Model invocation configuration (threadId, agentName)
 * @param options.model - Pre-instantiated LangChain chat model
 * @param options.tools - Tool definitions to bind to the model
 * @returns Agent response with message and metadata
 */
export async function invokeModel({
  redis,
  model,
  tools,
  config: { threadId, agentName },
}: {
  redis: Redis;
  tools: SerializableToolDefinition[];
  config: InvokeModelConfig;
  model: BaseChatModel<BaseChatModelCallOptions & { tools?: BindToolsInput }>;
}): Promise<AgentResponse> {
  const thread = createThreadManager({ redis, threadId });
  const runId = uuidv4();

  const messages = await thread.load();
  const response = await model.invoke(
    [...mapStoredMessagesToChatMessages(messages)],
    {
      runName: agentName,
      runId,
      metadata: { thread_id: threadId },
      tools,
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
}
