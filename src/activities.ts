import type Redis from "ioredis";
import { createThreadManager } from "./lib/thread-manager";
import type { ToolResultConfig } from "./lib/types";
import {
  type AIMessage,
  mapStoredMessageToChatMessage,
  type MessageContent,
  type StoredMessage,
} from "@langchain/core/messages";
import type { RawToolCall } from "./lib/tool-registry";
import type { FileNode } from "./lib/filesystem/types";

/**
 * File tree generation activity interface.
 * Implement this in your activities to generate dynamic file trees.
 *
 * The config parameter is optional and can be whatever your implementation needs
 * (user ID, project ID, filters, etc.).
 *
 * @example
 * ```typescript
 * // In your activities file
 * export const generateFileTree: GenerateFileTreeActivity<{ userId: string }> = async (
 *   config
 * ) => {
 *   const files = await db.getFilesForUser(config?.userId);
 *   return files.map((f) => ({
 *     path: f.path,
 *     type: "file" as const,
 *     metadata: { dbId: f.id },
 *   }));
 * };
 * ```
 */
export type GenerateFileTreeActivity<
  TConfig = Record<string, unknown>,
> = (config?: TConfig) => Promise<FileNode[]>;

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
   * Extract raw tool calls from a stored message.
   * Returns unvalidated tool calls - use toolRegistry.parseToolCall() to validate.
   */
  parseToolCalls(storedMessage: StoredMessage): Promise<RawToolCall[]>;
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

    async parseToolCalls(storedMessage: StoredMessage): Promise<RawToolCall[]> {
      const message = mapStoredMessageToChatMessage(storedMessage) as AIMessage;
      const toolCalls = message.tool_calls ?? [];

      return toolCalls.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        args: toolCall.args,
      }));
    },
  };
}
