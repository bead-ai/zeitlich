import type Redis from "ioredis";
import type { JsonValue, PersistedThreadState } from "../state/types";
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
  /**
   * Atomically replace the entire contents of the thread with `messages`.
   * The existing list is cleared, the new messages are appended in order,
   * and dedup markers from prior appends are cleared so future idempotent
   * appends with ids that were removed aren't silently skipped.
   *
   * Requires the thread manager to be configured with `idOf`.
   */
  replaceAll(messages: T[]): Promise<void>;
  /** Delete the thread */
  delete(): Promise<void>;
  /** Get the number of stored messages currently in the thread */
  length(): Promise<number>;
  /**
   * Truncate the thread starting at the message with id `messageId`.
   * That message and every message after it are removed. If `messageId`
   * is not present in the thread this is a no-op — useful as the
   * "truncate on entry" step of the `runAgent` activity, which becomes a
   * no-op on the first attempt and a cleanup on Temporal workflow reset
   * or in-workflow rewind retries.
   *
   * Dedup markers for removed single-message appends are also cleared so
   * that appending the same id again (e.g. the same assistant message id
   * on a rewind retry) is not silently skipped.
   *
   * Requires the thread manager to be configured with `idOf`.
   */
  truncateFromId(messageId: string): Promise<void>;
  /**
   * Load the persisted state slice associated with this thread, or
   * `null` if none has been saved yet. Safe to call on any thread —
   * treats a missing slice as a non-error.
   */
  loadState(): Promise<PersistedThreadState | null>;
  /**
   * Overwrite the persisted state slice for this thread. The thread
   * itself must already exist (same TTL as the message list).
   */
  saveState(state: PersistedThreadState): Promise<void>;
  /**
   * Copy the persisted state slice from this thread into `newThreadId`.
   * No-op if there is nothing to copy. The destination thread must
   * already exist.
   */
  forkState(newThreadId: string): Promise<void>;
  /** Delete just the persisted state slice, leaving messages intact. */
  deleteState(): Promise<void>;
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
  onPrepareMessage?: (
    message: TStored,
    index: number,
    thread: readonly TStored[]
  ) => TStored;
  /** Called for each SDK-native message after all processing, right before the payload is returned */
  onPreparedMessage?: (
    message: TPrepared,
    index: number,
    messages: readonly TPrepared[]
  ) => TPrepared;
  /**
   * One-shot list-level pre-pass applied once when a thread is forked with
   * `transform: true`. Runs before {@link onForkTransform}. May filter,
   * compact, prepend, or otherwise rewrite the whole forked thread — so the
   * returned length need not match the input length. Async, so implementations
   * may call an LLM or other I/O.
   */
  onForkPrepareThread?: (
    messages: readonly TStored[]
  ) => TStored[] | Promise<TStored[]>;
  /**
   * Per-message final pass applied once when a thread is forked with
   * `transform: true`. Runs after {@link onForkPrepareThread}. Pure 1:1 map —
   * must return a value for every input message; length cannot change. Same
   * shape as {@link onPreparedMessage}.
   */
  onForkTransform?: (
    message: TStored,
    index: number,
    messages: readonly TStored[]
  ) => TStored;
}

export interface ProviderThreadManager<
  TStored,
  TContent = string,
  TToolContent = JsonValue,
  TSystemContent = string,
> extends BaseThreadManager<TStored> {
  appendUserMessage(id: string, content: TContent): Promise<void>;
  appendSystemMessage(id: string, content: TSystemContent): Promise<void>;
  appendToolResult(
    id: string,
    toolCallId: string,
    toolName: string,
    content: TToolContent
  ): Promise<void>;
}
