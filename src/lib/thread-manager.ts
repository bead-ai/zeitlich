import type Redis from "ioredis";

import {
  type $InferMessageContent,
  AIMessage,
  HumanMessage,
  type MessageContent,
  type MessageStructure,
  type StoredMessage,
  SystemMessage,
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

export interface ThreadManagerConfig {
  redis: Redis;
  threadId: string;
  /** Thread key, defaults to 'messages' */
  key?: string;
}

export interface ThreadManager {
  /** Append a system message to the thread */
  appendSystemMessage(content: string): Promise<void>;
  /** Initialize an empty thread */
  initialize(): Promise<void>;
  /** Load all messages from the thread */
  load(): Promise<StoredMessage[]>;
  /** Append messages to the thread */
  append(messages: StoredMessage[]): Promise<void>;
  /** Delete the thread */
  delete(): Promise<void>;

  /** Create a SystemMessage (returns StoredMessage for storage) */
  createSystemMessage(content: string): StoredMessage;

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
 */
export function createThreadManager(
  config: ThreadManagerConfig
): ThreadManager {
  const { redis, threadId, key = "messages" } = config;
  const redisKey = getThreadKey(threadId, key);

  return {
    async initialize(): Promise<void> {
      await redis.del(redisKey);
    },

    async load(): Promise<StoredMessage[]> {
      const data = await redis.lrange(redisKey, 0, -1);
      return data.map((item) => JSON.parse(item) as StoredMessage);
    },

    async append(messages: StoredMessage[]): Promise<void> {
      if (messages.length > 0) {
        await redis.rpush(redisKey, ...messages.map((m) => JSON.stringify(m)));
        await redis.expire(redisKey, THREAD_TTL_SECONDS);
      }
    },

    async delete(): Promise<void> {
      await redis.del(redisKey);
    },

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
        // Cast needed due to langchain type compatibility
        content: content as MessageContent,
        tool_call_id: toolCallId,
      }).toDict();
    },

    createSystemMessage(content: string): StoredMessage {
      return new SystemMessage({
        content,
      }).toDict();
    },

    async appendSystemMessage(content: string): Promise<void> {
      const message = this.createSystemMessage(content);
      await this.append([message]);
    },

    async appendHumanMessage(content: string | MessageContent): Promise<void> {
      const message = this.createHumanMessage(content);
      await this.append([message]);
    },

    async appendToolMessage(
      content: ToolMessageContent,
      toolCallId: string
    ): Promise<void> {
      const message = this.createToolMessage(content, toolCallId);
      await this.append([message]);
    },

    async appendAIMessage(content: string | MessageContent): Promise<void> {
      const message = this.createAIMessage(content);
      await this.append([message]);
    },
  };
}
