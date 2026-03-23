import type Redis from "ioredis";
import type Anthropic from "@anthropic-ai/sdk";
import {
  createThreadManager,
  type BaseThreadManager,
  type ThreadManagerConfig,
} from "../../../lib/thread";
import type { MessageContent, ToolMessageContent } from "../../../lib/types";

/** A MessageParam with a unique ID for idempotent Redis storage */
export interface StoredMessage {
  id: string;
  message: Anthropic.Messages.MessageParam;
  /** System messages are stored separately since Anthropic passes them via config */
  isSystem?: boolean;
}

export interface AnthropicThreadManagerConfig {
  redis: Redis;
  threadId: string;
  /** Thread key, defaults to 'messages' */
  key?: string;
}

/** Thread manager with Anthropic MessageParam convenience helpers */
export interface AnthropicThreadManager
  extends BaseThreadManager<StoredMessage> {
  createUserMessage(
    id: string,
    content: string | MessageContent
  ): StoredMessage;
  createSystemMessage(id: string, content: string): StoredMessage;
  createAssistantMessage(
    id: string,
    content: Anthropic.Messages.ContentBlock[]
  ): StoredMessage;
  createToolResultMessage(
    id: string,
    toolCallId: string,
    toolName: string,
    content: ToolMessageContent
  ): StoredMessage;
  appendUserMessage(
    id: string,
    content: string | MessageContent
  ): Promise<void>;
  appendSystemMessage(id: string, content: string): Promise<void>;
  appendAssistantMessage(
    id: string,
    content: Anthropic.Messages.ContentBlock[]
  ): Promise<void>;
  appendToolResult(
    id: string,
    toolCallId: string,
    toolName: string,
    content: ToolMessageContent
  ): Promise<void>;
}

function storedMessageId(msg: StoredMessage): string {
  return msg.id;
}

/** Convert zeitlich MessageContent to Anthropic content blocks */
export function messageContentToBlocks(
  content: string | MessageContent
): Anthropic.Messages.ContentBlockParam[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (part.type === "text") {
        return { type: "text" as const, text: part.text as string };
      }
      if (part.type === "image") {
        return part as unknown as Anthropic.Messages.ContentBlockParam;
      }
      return part as unknown as Anthropic.Messages.ContentBlockParam;
    });
  }
  return [{ type: "text", text: String(content) }];
}

/** Convert ToolMessageContent to Anthropic tool result content */
function toolContentToBlocks(
  content: ToolMessageContent
): string | Anthropic.Messages.TextBlockParam[] {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => ({
      type: "text" as const,
      text: part.type === "text" ? (part.text as string) : JSON.stringify(part),
    }));
  }
  return String(content);
}

/**
 * Creates an Anthropic-specific thread manager that stores StoredMessage
 * instances in Redis and provides convenience helpers for creating and
 * appending typed messages.
 */
export function createAnthropicThreadManager(
  config: AnthropicThreadManagerConfig
): AnthropicThreadManager {
  const baseConfig: ThreadManagerConfig<StoredMessage> = {
    redis: config.redis,
    threadId: config.threadId,
    key: config.key,
    idOf: storedMessageId,
  };

  const base = createThreadManager(baseConfig);

  const helpers = {
    createUserMessage(
      id: string,
      content: string | MessageContent
    ): StoredMessage {
      return {
        id,
        message: {
          role: "user",
          content: messageContentToBlocks(content),
        },
      };
    },

    createSystemMessage(id: string, content: string): StoredMessage {
      return {
        id,
        message: { role: "user", content: content },
        isSystem: true,
      };
    },

    createAssistantMessage(
      id: string,
      content: Anthropic.Messages.ContentBlock[]
    ): StoredMessage {
      return {
        id,
        message: {
          role: "assistant",
          content: content as unknown as Anthropic.Messages.ContentBlockParam[],
        },
      };
    },

    createToolResultMessage(
      id: string,
      toolCallId: string,
      _toolName: string,
      content: ToolMessageContent
    ): StoredMessage {
      return {
        id,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result" as const,
              tool_use_id: toolCallId,
              content: toolContentToBlocks(content),
            },
          ],
        },
      };
    },

    async appendUserMessage(
      id: string,
      content: string | MessageContent
    ): Promise<void> {
      await base.append([helpers.createUserMessage(id, content)]);
    },

    async appendSystemMessage(id: string, content: string): Promise<void> {
      await base.initialize();
      await base.append([helpers.createSystemMessage(id, content)]);
    },

    async appendAssistantMessage(
      id: string,
      content: Anthropic.Messages.ContentBlock[]
    ): Promise<void> {
      await base.append([helpers.createAssistantMessage(id, content)]);
    },

    async appendToolResult(
      id: string,
      toolCallId: string,
      toolName: string,
      content: ToolMessageContent
    ): Promise<void> {
      await base.append([
        helpers.createToolResultMessage(id, toolCallId, toolName, content),
      ]);
    },
  };

  return Object.assign(base, helpers);
}
