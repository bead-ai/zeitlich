import type Redis from "ioredis";
import type { JsonValue } from "../../../lib/state/types";
import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
  type MessageContent,
  type StoredMessage,
  SystemMessage,
  ToolMessage,
  mapStoredMessagesToChatMessages,
} from "@langchain/core/messages";
import { createThreadManager } from "../../../lib/thread/manager";
import type {
  ProviderThreadManager,
  ThreadManagerConfig,
  ThreadManagerHooks,
} from "../../../lib/thread/types";

interface ToolCallRef {
  id: string;
  name: string;
}

/**
 * Repairs broken tool_use / tool_result pairings caused by activity retries.
 *
 * When a Temporal activity is retried, a second AI message (with new tool_calls)
 * can be appended before all tool_results from the first AI message have arrived.
 * This produces an invalid sequence that model providers reject.
 *
 * For each AI message that contains tool_calls, this function checks that every
 * tool_call id has a matching tool_result before the next non-tool message.
 * Missing results get a synthetic ToolMessage injected so the sequence is valid.
 */
export function sanitizeToolCallPairings(
  messages: StoredMessage[],
): StoredMessage[] {
  if (messages.length === 0) return messages;

  const result: StoredMessage[] = [];
  let pendingToolCallIds: Set<string> | null = null;
  let toolCallById: Map<string, ToolCallRef> | null = null;

  function flushSynthetics(): void {
    if (!pendingToolCallIds || pendingToolCallIds.size === 0) return;
    for (const missingId of pendingToolCallIds) {
      const tc = toolCallById?.get(missingId);
      result.push(
        new ToolMessage({
          content: "Tool call was not completed (activity retried)",
          tool_call_id: missingId,
          name: tc?.name,
        }).toDict(),
      );
    }
    pendingToolCallIds = null;
    toolCallById = null;
  }

  for (const msg of messages) {
    if (msg.type === "tool") {
      if (pendingToolCallIds) {
        const toolId = msg.data.tool_call_id;
        if (toolId) pendingToolCallIds.delete(toolId);
      }
      result.push(msg);
      continue;
    }

    flushSynthetics();
    result.push(msg);

    if (msg.type !== "ai") continue;
    const data = msg.data as unknown as Record<string, unknown>;
    const toolCalls: ToolCallRef[] =
      (data.tool_calls as ToolCallRef[] | undefined) ?? [];
    if (toolCalls.length === 0) continue;

    pendingToolCallIds = new Set(
      toolCalls.map((tc: ToolCallRef) => tc.id).filter(Boolean),
    );
    if (pendingToolCallIds.size === 0) {
      pendingToolCallIds = null;
      continue;
    }
    toolCallById = new Map(
      toolCalls
        .filter((tc: ToolCallRef) => tc.id)
        .map((tc: ToolCallRef) => [tc.id, tc]),
    );
  }

  flushSynthetics();
  return result;
}

/** SDK-native content type for LangChain human messages */
export type LangChainContent = string | MessageContent;

export type LangChainThreadManagerHooks = ThreadManagerHooks<StoredMessage, BaseMessage>;

export interface LangChainThreadManagerConfig {
  redis: Redis;
  threadId: string;
  /** Thread key, defaults to 'messages' */
  key?: string;
  hooks?: LangChainThreadManagerHooks;
}

/** Prepared payload ready to send to a LangChain chat model */
export interface LangChainInvocationPayload {
  messages: BaseMessage[];
}

/** Thread manager with LangChain StoredMessage convenience helpers */
export interface LangChainThreadManager
  extends ProviderThreadManager<StoredMessage, LangChainContent> {
  appendAIMessage(id: string, content: string | MessageContent): Promise<void>;
  prepareForInvocation(): Promise<LangChainInvocationPayload>;
}

function storedMessageId(msg: StoredMessage): string {
  if (msg.type === "tool" && msg.data.tool_call_id) {
    return msg.data.tool_call_id;
  }

  if (msg.data.id) {
    return msg.data.id;
  }

  throw new Error("No id found for message");
}

/**
 * Creates a LangChain-specific thread manager that stores StoredMessage
 * instances in Redis and provides convenience helpers for creating and
 * appending typed LangChain messages.
 */
export function createLangChainThreadManager(
  config: LangChainThreadManagerConfig,
): LangChainThreadManager {
  const baseConfig: ThreadManagerConfig<StoredMessage> = {
    redis: config.redis,
    threadId: config.threadId,
    key: config.key,
    idOf: storedMessageId,
  };

  const base = createThreadManager(baseConfig);

  const helpers: Omit<LangChainThreadManager, keyof typeof base> = {
    async appendUserMessage(
      id: string,
      content: LangChainContent,
    ): Promise<void> {
      await base.append([
        new HumanMessage({ id, content: content as MessageContent }).toDict(),
      ]);
    },

    async appendSystemMessage(id: string, content: string): Promise<void> {
      await base.initialize();
      await base.append([
        new SystemMessage({ id, content }).toDict(),
      ]);
    },

    async appendAIMessage(
      id: string,
      content: string | MessageContent,
    ): Promise<void> {
      await base.append([
        new AIMessage({ id, content: content as MessageContent }).toDict(),
      ]);
    },

    async appendToolResult(
      id: string,
      _toolCallId: string,
      _toolName: string,
      content: JsonValue,
    ): Promise<void> {
      await base.append([
        new ToolMessage({ id, content: content as MessageContent, tool_call_id: _toolCallId }).toDict(),
      ]);
    },

    async prepareForInvocation(): Promise<LangChainInvocationPayload> {
      const stored = await base.load();
      const sanitized = sanitizeToolCallPairings(stored);
      const { onPrepareMessage, onPreparedMessage } = config.hooks ?? {};
      const mapped = onPrepareMessage
        ? sanitized.map((msg, i) => onPrepareMessage(msg, i, sanitized))
        : sanitized;
      const messages = mapStoredMessagesToChatMessages(mapped);
      return {
        messages: onPreparedMessage
          ? messages.map((msg, i) => onPreparedMessage(msg, i, messages))
          : messages,
      };
    },
  };

  return Object.assign(base, helpers);
}
