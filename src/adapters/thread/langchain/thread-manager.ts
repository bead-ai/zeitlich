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

/** SDK-native content type for LangChain human messages */
export type LangChainContent = string | MessageContent;

/** SDK-native content type for LangChain system messages */
export type LangChainSystemContent = string | MessageContent;

export type LangChainThreadManagerHooks = ThreadManagerHooks<
  StoredMessage,
  BaseMessage
>;

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
export interface LangChainThreadManager extends ProviderThreadManager<
  StoredMessage,
  LangChainContent,
  JsonValue,
  LangChainSystemContent
> {
  appendAIMessage(id: string, content: string | MessageContent): Promise<void>;
  /**
   * Fork this thread into `newThreadId` and apply the adapter's fork-time
   * hooks (`onForkPrepareThread` then `onForkTransform`) to the new thread.
   * If neither hook is configured, this is equivalent to {@link fork}.
   */
  forkWithTransform(newThreadId: string): Promise<LangChainThreadManager>;
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
  config: LangChainThreadManagerConfig
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
      content: LangChainContent
    ): Promise<void> {
      await base.append([
        new HumanMessage({ id, content: content as MessageContent }).toDict(),
      ]);
    },

    async appendSystemMessage(
      id: string,
      content: LangChainSystemContent
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
      content: string | MessageContent
    ): Promise<void> {
      await base.append([
        new AIMessage({ id, content: content as MessageContent }).toDict(),
      ]);
    },

    async forkWithTransform(
      newThreadId: string
    ): Promise<LangChainThreadManager> {
      const forked = createLangChainThreadManager({
        ...config,
        threadId: newThreadId,
      });
      await base.fork(newThreadId);
      const { onForkPrepareThread, onForkTransform } = config.hooks ?? {};
      if (!onForkPrepareThread && !onForkTransform) {
        return forked;
      }
      let next = await forked.load();
      if (onForkPrepareThread) {
        next = await onForkPrepareThread(next);
      }
      if (onForkTransform) {
        next = next.map((msg, i) => onForkTransform(msg, i, next));
      }
      await forked.replaceAll(next);
      return forked;
    },

    async appendToolResult(
      id: string,
      _toolCallId: string,
      _toolName: string,
      content: JsonValue
    ): Promise<void> {
      await base.append([
        new ToolMessage({
          id,
          content: content as MessageContent,
          tool_call_id: _toolCallId,
        }).toDict(),
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
