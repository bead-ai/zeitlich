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

/**
 * Lua script for atomic idempotent append.
 * Checks a dedup key; if it exists the message was already appended and we
 * return 0. Otherwise appends all messages to the list, sets TTL on both
 * the list and the dedup key, and returns 1.
 *
 * KEYS[1] = dedup key, KEYS[2] = list key
 * ARGV[1] = TTL seconds, ARGV[2..N] = serialised messages
 */
const APPEND_IDEMPOTENT_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return 0
end
for i = 2, #ARGV do
  redis.call('RPUSH', KEYS[2], ARGV[i])
end
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[1]))
redis.call('SET', KEYS[1], '1', 'EX', tonumber(ARGV[1]))
return 1
`;

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
  /**
   * Extract a unique id from a message for idempotent appends.
   * When provided, `append` uses an atomic Lua script to skip duplicate writes.
   * Defaults to `StoredMessage.data.id` for the standard ThreadManager.
   */
  idOf?: (message: T) => string;
}

/** Generic thread manager for any message type */
export interface BaseThreadManager<T> {
  /** Initialize an empty thread */
  initialize(): Promise<void>;
  /** Load all messages from the thread */
  load(): Promise<T[]>;
  /**
   * Append messages to the thread.
   * When `idOf` is configured, appends are idempotent — retries with the
   * same message ids are atomically skipped via a Redis Lua script.
   */
  append(messages: T[]): Promise<void>;
  /** Delete the thread */
  delete(): Promise<void>;
}

/** Thread manager with StoredMessage convenience helpers */
export interface ThreadManager extends BaseThreadManager<StoredMessage> {
  /** Create a HumanMessage (returns StoredMessage for storage) */
  createHumanMessage(content: string | MessageContent): StoredMessage;
  /** Create a SystemMessage (returns StoredMessage for storage) */
  createSystemMessage(content: string): StoredMessage;
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

/** Default id extractor for StoredMessage */
function storedMessageId(msg: StoredMessage): string {
  return msg.data.id ?? "";
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

  // Default idOf for StoredMessage when no custom serialization is used
  const idOf =
    config.idOf ??
    (!config.serialize
      ? (storedMessageId as unknown as (m: T) => string)
      : undefined);

  const metaKey = getThreadKey(threadId, `${key}:meta`);

  async function assertThreadExists(): Promise<void> {
    const exists = await redis.exists(metaKey);
    if (!exists) {
      throw new Error(`Thread "${threadId}" (key: ${key}) does not exist`);
    }
  }

  const base: BaseThreadManager<T> = {
    async initialize(): Promise<void> {
      await redis.del(redisKey);
      await redis.set(metaKey, "1", "EX", THREAD_TTL_SECONDS);
    },

    async load(): Promise<T[]> {
      await assertThreadExists();
      const data = await redis.lrange(redisKey, 0, -1);
      return data.map(deserialize);
    },

    async append(messages: T[]): Promise<void> {
      if (messages.length === 0) return;
      await assertThreadExists();

      if (idOf) {
        const dedupId = messages.map(idOf).join(":");
        const dedupKey = getThreadKey(threadId, `dedup:${dedupId}`);
        await redis.eval(
          APPEND_IDEMPOTENT_SCRIPT,
          2,
          dedupKey,
          redisKey,
          String(THREAD_TTL_SECONDS),
          ...messages.map(serialize)
        );
      } else {
        await redis.rpush(redisKey, ...messages.map(serialize));
        await redis.expire(redisKey, THREAD_TTL_SECONDS);
      }
    },

    async delete(): Promise<void> {
      await redis.del(redisKey, metaKey);
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

    createSystemMessage(content: string): StoredMessage {
      return new SystemMessage({
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
        id: uuidv4(),
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

    async appendSystemMessage(content: string): Promise<void> {
      const message = helpers.createSystemMessage(content);
      await (base as BaseThreadManager<StoredMessage>).append([message]);
    },
  };

  return Object.assign(base, helpers);
}
