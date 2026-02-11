import type Redis from "ioredis";
import { createThreadManager } from "./thread-manager";
import type { AgentResponse } from "./types";
import { Context } from "@temporalio/activity";
import type { WorkflowClient } from "@temporalio/client";
import { mapStoredMessagesToChatMessages } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";
import type {
  BaseChatModel,
  BaseChatModelCallOptions,
  BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import { getStateQuery } from "./state-manager";

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
 * @param redis - Redis client for thread management
 * @param config - Model invocation configuration
 * @param model - Pre-instantiated LangChain chat model
 * @param invocationConfig - Per-invocation configuration (system prompt, etc.)
 * @returns Agent response with message and metadata
 */
export async function invokeModel({
  redis,
  model,
  client,
  config: { threadId, agentName },
}: {
  redis: Redis;
  client: WorkflowClient;
  config: InvokeModelConfig;
  model: BaseChatModel<BaseChatModelCallOptions & { tools?: BindToolsInput }>;
}): Promise<AgentResponse> {
  const thread = createThreadManager({ redis, threadId });
  const runId = uuidv4();

  const info = Context.current().info; // Activity info
  const parentWorkflowId = info.workflowExecution.workflowId;
  const parentRunId = info.workflowExecution.runId;

  const handle = client.getHandle(parentWorkflowId, parentRunId);
  const { tools } = await handle.query(getStateQuery);

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

  return {
    message: response.toDict(),
    usage: {
      input_tokens: response.usage_metadata?.input_tokens,
      output_tokens: response.usage_metadata?.output_tokens,
      total_tokens: response.usage_metadata?.total_tokens,
    },
  };
}
