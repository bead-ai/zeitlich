import type Redis from "ioredis";
import { createThreadManager } from "./lib/thread-manager";
import type { ToolResultConfig } from "./lib/types";
import {
  type MessageContent,
  type StoredMessage,
} from "@langchain/core/messages";
/**
 * Shared Zeitlich activities - thread management and message handling
 * Note: runAgent is workflow-specific and should be created per-workflow
 */
export interface ZeitlichSharedActivities {
  /**
   * Append a tool result to the thread.
   * Handles JSON serialization and optional cache points.
   */
  appendToolResult(config: ToolResultConfig): Promise<void>;

  /**
   * Initialize an empty thread.
   */
  initializeThread(threadId: string): Promise<void>;

  /**
   * Append messages to a thread.
   */
  appendThreadMessages(
    threadId: string,
    messages: StoredMessage[]
  ): Promise<void>;

  /**
   * Append a human message to a thread.
   */
  appendHumanMessage(
    threadId: string,
    content: string | MessageContent
  ): Promise<void>;

  /**
   * Append a system message to a thread.
   */
  appendSystemMessage(threadId: string, content: string): Promise<void>;
}

/**
 * Creates shared Temporal activities for thread management
 *
 * @returns An object containing the shared activity functions
 *
 * @experimental The Zeitlich integration is an experimental feature; APIs may change without notice.
 */
export function createSharedActivities(redis: Redis): ZeitlichSharedActivities {
  return {
    async appendToolResult(config: ToolResultConfig): Promise<void> {
      const { threadId, toolCallId, content } = config;
      const thread = createThreadManager({ redis, threadId });

      await thread.appendToolMessage(content, toolCallId);
    },

    async initializeThread(threadId: string): Promise<void> {
      const thread = createThreadManager({ redis, threadId });
      await thread.initialize();
    },

    async appendThreadMessages(
      threadId: string,
      messages: StoredMessage[]
    ): Promise<void> {
      const thread = createThreadManager({ redis, threadId });
      await thread.append(messages);
    },

    async appendHumanMessage(
      threadId: string,
      content: string | MessageContent
    ): Promise<void> {
      const thread = createThreadManager({ redis, threadId });
      await thread.appendHumanMessage(content);
    },

    async appendSystemMessage(
      threadId: string,
      content: string
    ): Promise<void> {
      const thread = createThreadManager({ redis, threadId });
      await thread.appendSystemMessage(content);
    },
  };
}
