import type Redis from "ioredis";
import type Anthropic from "@anthropic-ai/sdk";
import type { SerializableToolDefinition } from "../../../lib/types";
import type { AgentResponse, ModelInvokerConfig } from "../../../lib/model";
import {
  createAnthropicThreadManager,
  type AnthropicThreadManagerHooks,
} from "./thread-manager";
import {
  addPromptCacheControl,
  resolvePromptCacheOptions,
  type AnthropicPromptCacheConfig,
} from "./prompt-cache";
import { getActivityContext } from "../../../lib/activity";

export interface AnthropicModelInvokerConfig {
  redis: Redis;
  client: Anthropic;
  model: string;
  /** Maximum tokens to generate. Defaults to 16384. */
  maxTokens?: number;
  /**
   * Controls Anthropic/Bedrock-compatible prompt caching. Defaults to enabled
   * with an explicit 5 minute TTL. Set to `false` to disable.
   */
  promptCache?: AnthropicPromptCacheConfig;
  hooks?: AnthropicThreadManagerHooks;
}

function toAnthropicTools(
  tools: SerializableToolDefinition[]
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
 * Internally streams the response and emits Temporal heartbeats on each
 * event so that long-running LLM calls remain visible to the scheduler.
 * The caller is responsible for appending the response to the thread.
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
 * return { ...createRunAgentActivity(client, invoker, "myAgent") };
 * ```
 */
export function createAnthropicModelInvoker({
  redis,
  client,
  model,
  maxTokens = 16384,
  promptCache,
  hooks,
}: AnthropicModelInvokerConfig) {
  return async function invokeAnthropicModel(
    config: ModelInvokerConfig
  ): Promise<AgentResponse<Anthropic.Messages.Message>> {
    const { threadId, threadKey, state, assistantMessageId } = config;
    const { heartbeat, signal } = getActivityContext();

    const thread = createAnthropicThreadManager({
      redis,
      threadId,
      key: threadKey,
      hooks,
    });
    // Truncate the thread starting at the id the assistant message
    // will be stored under. On the happy path this is a no-op; on a
    // rewind retry or a Temporal workflow reset it wipes the prior
    // attempt's assistant + tool results so the LLM sees the same
    // pre-call state that it saw originally.
    await thread.truncateFromId(assistantMessageId);
    const prepared = await thread.prepareForInvocation();

    const anthropicTools = toAnthropicTools(state.tools);
    const preparedPayload = {
      ...prepared,
      ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
    };
    const cacheOptions = resolvePromptCacheOptions(promptCache);
    const payload = cacheOptions
      ? addPromptCacheControl(preparedPayload, cacheOptions)
      : preparedPayload;

    const params: Anthropic.MessageCreateParams = {
      model,
      max_tokens: maxTokens,
      messages: payload.messages,
      ...(payload.system ? { system: payload.system } : {}),
      ...(payload.tools ? { tools: payload.tools } : {}),
    };

    const stream = client.messages.stream(params, { signal });

    for await (const _event of stream) {
      heartbeat?.();
    }

    const response: Anthropic.Messages.Message = await stream.finalMessage();

    const toolCalls = response.content.filter(
      (block): block is Anthropic.Messages.ToolUseBlock =>
        block.type === "tool_use"
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
        cachedWriteTokens:
          response.usage.cache_creation_input_tokens ?? undefined,
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
  promptCache,
  hooks,
  config,
}: {
  redis: Redis;
  client: Anthropic;
  model: string;
  maxTokens?: number;
  promptCache?: AnthropicPromptCacheConfig;
  hooks?: AnthropicThreadManagerHooks;
  config: ModelInvokerConfig;
}): Promise<AgentResponse<Anthropic.Messages.Message>> {
  const invoker = createAnthropicModelInvoker({
    redis,
    client,
    model,
    maxTokens,
    promptCache,
    hooks,
  });
  return invoker(config);
}
