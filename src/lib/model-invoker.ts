import type Redis from "ioredis";
import { createThreadManager } from "./thread-manager";
import type { AgentResponse, InvocationConfig } from "./types";
import type { ToolDefinition } from "./tool-registry";
import {
  mapStoredMessagesToChatMessages,
  SystemMessage,
} from "@langchain/core/messages";
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
  tools?: ToolDefinition[];
}

/**
 * Core model invocation logic - shared utility for workflow-specific activities
 *
 * @param redis - Redis client for thread management
 * @param config - Model invocation configuration
 * @param model - Pre-instantiated LangChain chat model
 * @param invocationConfig - Per-invocation configuration (system prompt, etc.)
 * @returns Agent response with message and metadata
 */
export async function invokeModel(
  redis: Redis,
  { threadId, agentName, tools }: InvokeModelConfig,
  model: BaseChatModel<BaseChatModelCallOptions & { tools?: BindToolsInput }>,
  { systemPrompt }: InvocationConfig
): Promise<AgentResponse> {
  const thread = createThreadManager({ redis, threadId });
  const runId = uuidv4();

  const messages = await thread.load();
  const response = await model.invoke(
    [
      new SystemMessage(systemPrompt),
      ...mapStoredMessagesToChatMessages(messages),
    ],
    {
      runName: agentName,
      runId,
      metadata: { thread_id: threadId },
      tools,
    }
  );

  await thread.append([response.toDict()]);

  return {
    message: response.toDict(),
    stopReason: (response.response_metadata?.stop_reason as string) ?? null,
    usage: {
      input_tokens: response.usage_metadata?.input_tokens,
      output_tokens: response.usage_metadata?.output_tokens,
      total_tokens: response.usage_metadata?.total_tokens,
    },
  };
}
