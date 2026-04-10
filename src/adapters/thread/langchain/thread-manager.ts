import type Redis from "ioredis";
import type { JsonValue } from "../../../lib/state/types";
import type { SystemPromptContent } from "../../../lib/types";
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

    async appendSystemMessage(
      id: string,
      content: SystemPromptContent,
    ): Promise<void> {
      await base.initialize();
      await base.append([
        new SystemMessage({
          id,
          content: content as MessageContent,
        }).toDict(),
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
      const { onPrepareMessage, onPreparedMessage } = config.hooks ?? {};
      const mapped = onPrepareMessage
        ? stored.map((msg, i) => onPrepareMessage(msg, i, stored))
        : stored;
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
