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
 * Core model invocation logic - shared utility for workflow-specific activities.
 * Loads the conversation thread from Redis, queries the parent workflow for
 * current tool definitions, invokes the LLM, and appends the response.
 *
 * @param options.redis - Redis client for thread management
 * @param options.config - `{ threadId, agentName }` identifying the conversation and agent
 * @param options.model - Pre-instantiated LangChain chat model (e.g. `ChatAnthropic`, `ChatOpenAI`)
 * @param options.client - Temporal WorkflowClient for querying workflow state (tools)
 * @returns Agent response with message, raw tool calls, and token usage
 *
 * @example
 * ```typescript
 * import { invokeModel, type InvokeModelConfig } from 'zeitlich';
 * import { ChatAnthropic } from '@langchain/anthropic';
 *
 * export const createActivities = ({ redis, client }) => ({
 *   runAgentActivity: (config: InvokeModelConfig) => {
 *     const model = new ChatAnthropic({
 *       model: "claude-sonnet-4-6",
 *       maxTokens: 4000,
 *     });
 *     return invokeModel({ config, model, redis, client });
 *   },
 * });
 * ```
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
