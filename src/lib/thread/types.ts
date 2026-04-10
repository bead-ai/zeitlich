import type Redis from "ioredis";
import type { JsonValue } from "../state/types";
import type { SystemPromptContent } from "../types";

export interface ThreadManagerConfig<T> {
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
  /**
   * Copy all messages from this thread into a new thread, leaving the
   * original intact. Returns the new thread's manager. Safe for parallel
   * forks — each call creates an independent copy.
   */
  fork(newThreadId: string): Promise<BaseThreadManager<T>>;
  /** Delete the thread */
  delete(): Promise<void>;
}

/**
 * Shared contract for provider-specific thread managers.
 *
 * Extends {@link BaseThreadManager} with the append operations that the
 * session layer calls via {@link ThreadOps} activities. Each adapter
 * implements this interface to translate generic append calls into
 * SDK-native stored messages.
 *
 * `appendAssistantMessage` / `appendModelContent` are intentionally NOT
 * part of this interface — they are adapter-specific and only called by
 * the model invoker inside the adapter.
 *
 * @typeParam TStored - The stored message envelope (includes id + SDK payload)
 * @typeParam TContent - SDK-native content type for human messages
 */
/**
 * Lifecycle hooks for provider-specific thread managers.
 *
 * @typeParam TStored - The stored message envelope (e.g. StoredMessage, StoredContent)
 * @typeParam TPrepared - The SDK-native message type after preparation (e.g. BaseMessage, MessageParam, Content)
 */
export interface ThreadManagerHooks<TStored, TPrepared = TStored> {
  /** Called for each stored message before SDK-specific processing (system extraction, role merging, format conversion) */
  onPrepareMessage?: (message: TStored, index: number, thread: readonly TStored[]) => TStored;
  /** Called for each SDK-native message after all processing, right before the payload is returned */
  onPreparedMessage?: (message: TPrepared, index: number, messages: readonly TPrepared[]) => TPrepared;
}

export interface ProviderThreadManager<
  TStored,
  TContent = string,
  TToolContent = JsonValue,
> extends BaseThreadManager<TStored> {
  appendUserMessage(id: string, content: TContent): Promise<void>;
  appendSystemMessage(id: string, content: SystemPromptContent): Promise<void>;
  appendToolResult(
    id: string,
    toolCallId: string,
    toolName: string,
    content: TToolContent,
  ): Promise<void>;
}
