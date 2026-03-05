import type Redis from "ioredis";

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
  /** Delete the thread */
  delete(): Promise<void>;
}
