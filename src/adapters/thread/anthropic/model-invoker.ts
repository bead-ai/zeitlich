import type Redis from "ioredis";
import type Anthropic from "@anthropic-ai/sdk";
import type { SerializableToolDefinition } from "../../../lib/types";
import type { AgentResponse, ModelInvokerConfig } from "../../../lib/model";
import { createAnthropicThreadManager, type AnthropicThreadManagerHooks } from "./thread-manager";
import { v4 as uuidv4 } from "uuid";

export interface AnthropicModelInvokerConfig {
  redis: Redis;
  client: Anthropic;
  model: string;
  /** Maximum tokens to generate. Defaults to 16384. */
  maxTokens?: number;
  hooks?: AnthropicThreadManagerHooks;
}

function toAnthropicTools(
  tools: SerializableToolDefinition[],
): Anthropic.Messages.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.schema as Anthropic.Messages.Tool.InputSchema,
  }));
}

/**
 * Creates an Anthropic model invoker that satisfies the generic
 * `ModelInvoker<Anthropic.Messages.Message>` contract.
 *
 * Loads the conversation thread from Redis, invokes the Claude model via
 * `client.messages.create`, appends the AI response, and returns
 * a normalised AgentResponse.
 *
 * @example
 * ```typescript
 * import { createAnthropicModelInvoker } from 'zeitlich/adapters/thread/anthropic';
 * import { createRunAgentActivity } from 'zeitlich';
 * import Anthropic from '@anthropic-ai/sdk';
 *
 * const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
 * const invoker = createAnthropicModelInvoker({
 *   redis,
 *   client,
 *   model: 'claude-sonnet-4-20250514',
 * });
 *
 * return { runAgent: createRunAgentActivity(client, invoker) };
 * ```
 */
export function createAnthropicModelInvoker({
  redis,
  client,
  model,
  maxTokens = 16384,
  hooks,
}: AnthropicModelInvokerConfig) {
  return async function invokeAnthropicModel(
    config: ModelInvokerConfig,
  ): Promise<AgentResponse<Anthropic.Messages.Message>> {
    const { threadId, threadKey, state } = config;

    const thread = createAnthropicThreadManager({ redis, threadId, key: threadKey, hooks });
    const { messages, system } = await thread.prepareForInvocation();

    const anthropicTools = toAnthropicTools(state.tools);
    const tools = anthropicTools.length > 0 ? anthropicTools : undefined;

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages,
      ...(system ? { system } : {}),
      ...(tools ? { tools } : {}),
    });

    await thread.appendAssistantMessage(uuidv4(), response.content);

    const toolCalls = response.content.filter(
      (block): block is Anthropic.Messages.ToolUseBlock =>
        block.type === "tool_use",
    );

    return {
      message: response,
      rawToolCalls: toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        args: (tc.input as Record<string, unknown>) ?? {},
      })),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedWriteTokens: response.usage.cache_creation_input_tokens ?? undefined,
        cachedReadTokens: response.usage.cache_read_input_tokens ?? undefined,
      },
    };
  };
}

/**
 * Standalone function for one-shot Anthropic model invocation.
 * Convenience wrapper around createAnthropicModelInvoker for cases
 * where you don't need to reuse the invoker.
 */
export async function invokeAnthropicModel({
  redis,
  client,
  model,
  maxTokens,
  hooks,
  config,
}: {
  redis: Redis;
  client: Anthropic;
  model: string;
  maxTokens?: number;
  hooks?: AnthropicThreadManagerHooks;
  config: ModelInvokerConfig;
}): Promise<AgentResponse<Anthropic.Messages.Message>> {
  const invoker = createAnthropicModelInvoker({
    redis,
    client,
    model,
    maxTokens,
    hooks,
  });
  return invoker(config);
}
