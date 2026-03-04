import type Redis from "ioredis";
import type { ZeitlichSharedActivities } from "../../activities";
import type { ToolResultConfig } from "../../lib/types";
import type { MessageContent } from "@langchain/core/messages";
import { createLangChainThreadManager } from "./thread-manager";

/**
 * Creates shared Temporal activities for thread management using LangChain
 * message types.
 *
 * This is the LangChain-specific implementation of `ZeitlichSharedActivities`.
 * It converts framework-agnostic MessageContent into LangChain StoredMessages
 * and stores them via a LangChainThreadManager.
 */
export function createLangChainSharedActivities(
  redis: Redis,
): ZeitlichSharedActivities {
  return {
    async appendToolResult(config: ToolResultConfig): Promise<void> {
      const { threadId, toolCallId, content } = config;
      const thread = createLangChainThreadManager({ redis, threadId });
      await thread.appendToolMessage(content, toolCallId);
    },

    async initializeThread(threadId: string): Promise<void> {
      const thread = createLangChainThreadManager({ redis, threadId });
      await thread.initialize();
    },

    async appendThreadMessages(
      threadId: string,
      messages: unknown[],
    ): Promise<void> {
      const thread = createLangChainThreadManager({ redis, threadId });
      // Messages are expected to be StoredMessage when using the LangChain adapter
      await thread.append(messages as Awaited<ReturnType<typeof thread.load>>);
    },

    async appendHumanMessage(
      threadId: string,
      content: string | MessageContent,
    ): Promise<void> {
      const thread = createLangChainThreadManager({ redis, threadId });
      await thread.appendHumanMessage(content);
    },

    async appendSystemMessage(
      threadId: string,
      content: string,
    ): Promise<void> {
      const thread = createLangChainThreadManager({ redis, threadId });
      await thread.appendSystemMessage(content);
    },
  };
}
