import type Redis from "ioredis";

import {
  type $InferMessageContent,
  AIMessage,
  HumanMessage,
  type MessageContent,
  type MessageStructure,
  type StoredMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";

const THREAD_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

function getThreadKey(threadId: string, key: string): string {
  return `thread:${threadId}:${key}`;
}

/**
 * Content for a tool message response.
 * Can be a simple string or complex content parts (text, images, cache points, etc.)
 */
export type ToolMessageContent = $InferMessageContent<MessageStructure, "tool">;

export interface ThreadManagerConfig<T = StoredMessage> {
  redis: Redis;
  threadId: string;
  /** Thread key, defaults to 'messages' */
  key?: string;
  /** Custom serializer, defaults to JSON.stringify */
  serialize?: (message: T) => string;
  /** Custom deserializer, defaults to JSON.parse */
  deserialize?: (raw: string) => T;
}

/** Generic thread manager for any message type */
export interface BaseThreadManager<T> {
  /** Initialize an empty thread */
  initialize(): Promise<void>;
  /** Load all messages from the thread */
  load(): Promise<T[]>;
  /** Append messages to the thread */
  append(messages: T[]): Promise<void>;
  /** Delete the thread */
  delete(): Promise<void>;
}

/** Thread manager with StoredMessage convenience helpers */
export interface ThreadManager extends BaseThreadManager<StoredMessage> {
  /** Create a HumanMessage (returns StoredMessage for storage) */
  createHumanMessage(content: string | MessageContent): StoredMessage;
  /** Create an AIMessage with optional additional kwargs */
  createAIMessage(
    content: string | MessageContent,
    kwargs?: { header?: string; options?: string[]; multiSelect?: boolean }
  ): StoredMessage;
  /** Create a ToolMessage */
  createToolMessage(
    content: ToolMessageContent,
    toolCallId: string
  ): StoredMessage;
  /** Create and append a HumanMessage */
  appendHumanMessage(content: string | MessageContent): Promise<void>;
  /** Create and append a SystemMessage */
  appendSystemMessage(content: string): Promise<void>;
  /** Create and append a ToolMessage */
  appendToolMessage(
    content: ToolMessageContent,
    toolCallId: string
  ): Promise<void>;
  /** Create and append an AIMessage */
  appendAIMessage(content: string | MessageContent): Promise<void>;
}

/**
 * Creates a thread manager for handling conversation state in Redis.
 * Without generic args, returns a full ThreadManager with StoredMessage helpers.
 * With a custom type T, returns a BaseThreadManager<T>.
 */
export function createThreadManager(config: ThreadManagerConfig): ThreadManager;
export function createThreadManager<T>(
  config: ThreadManagerConfig<T>
): BaseThreadManager<T>;
export function createThreadManager<T>(
  config: ThreadManagerConfig<T>
): BaseThreadManager<T> {
  const {
    redis,
    threadId,
    key = "messages",
    serialize = (m: T): string => JSON.stringify(m),
    deserialize = (raw: string): T => JSON.parse(raw) as T,
  } = config;
  const redisKey = getThreadKey(threadId, key);

  const base: BaseThreadManager<T> = {
    async initialize(): Promise<void> {
      await redis.del(redisKey);
    },

    async load(): Promise<T[]> {
      const data = await redis.lrange(redisKey, 0, -1);
      return data.map(deserialize);
    },

    async append(messages: T[]): Promise<void> {
      if (messages.length > 0) {
        await redis.rpush(redisKey, ...messages.map(serialize));
        await redis.expire(redisKey, THREAD_TTL_SECONDS);
      }
    },

    async delete(): Promise<void> {
      await redis.del(redisKey);
    },
  };

  // If no custom serialize/deserialize were provided and T defaults to StoredMessage,
  // the overload guarantees the caller gets ThreadManager with convenience helpers.
  const helpers = {
    createHumanMessage(content: string | MessageContent): StoredMessage {
      return new HumanMessage({
        id: uuidv4(),
        content: content as string,
      }).toDict();
    },

    createAIMessage(
      content: string,
      kwargs?: { header?: string; options?: string[]; multiSelect?: boolean }
    ): StoredMessage {
      return new AIMessage({
        id: uuidv4(),
        content,
        additional_kwargs: kwargs
          ? {
              header: kwargs.header,
              options: kwargs.options,
              multiSelect: kwargs.multiSelect,
            }
          : undefined,
      }).toDict();
    },

    createToolMessage(
      content: ToolMessageContent,
      toolCallId: string
    ): StoredMessage {
      return new ToolMessage({
        content: content as MessageContent,
        tool_call_id: toolCallId,
      }).toDict();
    },

    async appendHumanMessage(content: string | MessageContent): Promise<void> {
      const message = helpers.createHumanMessage(content);
      await (base as BaseThreadManager<StoredMessage>).append([message]);
    },

    async appendToolMessage(
      content: ToolMessageContent,
      toolCallId: string
    ): Promise<void> {
      const message = helpers.createToolMessage(content, toolCallId);
      await (base as BaseThreadManager<StoredMessage>).append([message]);
    },

    async appendAIMessage(content: string | MessageContent): Promise<void> {
      const message = helpers.createAIMessage(content as string);
      await (base as BaseThreadManager<StoredMessage>).append([message]);
    },
  };

  return Object.assign(base, helpers);
}
