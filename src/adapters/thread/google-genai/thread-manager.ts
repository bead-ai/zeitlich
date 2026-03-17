import type Redis from "ioredis";
import type { Content, Part } from "@google/genai";
import {
  createThreadManager,
  type BaseThreadManager,
  type ThreadManagerConfig,
} from "../../../lib/thread";
import type { MessageContent, ToolMessageContent } from "../../../lib/types";

/** A Content with a unique ID for idempotent Redis storage */
export interface StoredContent {
  id: string;
  content: Content;
}

export interface GoogleGenAIThreadManagerConfig {
  redis: Redis;
  threadId: string;
  /** Thread key, defaults to 'messages' */
  key?: string;
}

/** Thread manager with Google GenAI Content convenience helpers */
export interface GoogleGenAIThreadManager extends BaseThreadManager<StoredContent> {
  createUserContent(
    id: string,
    content: string | MessageContent
  ): StoredContent;
  createSystemContent(id: string, content: string): StoredContent;
  createModelContent(id: string, parts: Part[]): StoredContent;
  createToolResponseContent(
    id: string,
    toolCallId: string,
    toolName: string,
    content: ToolMessageContent
  ): StoredContent;
  appendUserMessage(
    id: string,
    content: string | MessageContent
  ): Promise<void>;
  appendSystemMessage(id: string, content: string): Promise<void>;
  appendModelContent(id: string, parts: Part[]): Promise<void>;
  appendToolResult(
    id: string,
    toolCallId: string,
    toolName: string,
    content: ToolMessageContent
  ): Promise<void>;
}

function storedContentId(msg: StoredContent): string {
  return msg.id;
}

/** Convert zeitlich MessageContent to Google GenAI Part[] */
export function messageContentToParts(
  content: string | MessageContent
): Part[] {
  if (typeof content === "string") {
    return [{ text: content }];
  }
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (part.type === "text") {
        return { text: part.text as string };
      }
      return part as unknown as Part;
    });
  }
  return [{ text: String(content) }];
}

/** Parse ToolMessageContent into a Record suitable for functionResponse */
function parseToolResponse(
  content: ToolMessageContent
): Record<string, unknown> {
  if (typeof content === "string") {
    try {
      const parsed: unknown = JSON.parse(content);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : { result: content };
    } catch {
      return { result: content };
    }
  }
  return { result: content };
}

/**
 * Creates a Google GenAI-specific thread manager that stores StoredContent
 * instances in Redis and provides convenience helpers for creating and
 * appending typed Content messages.
 */
export function createGoogleGenAIThreadManager(
  config: GoogleGenAIThreadManagerConfig
): GoogleGenAIThreadManager {
  const baseConfig: ThreadManagerConfig<StoredContent> = {
    redis: config.redis,
    threadId: config.threadId,
    key: config.key,
    idOf: storedContentId,
  };

  const base = createThreadManager(baseConfig);

  const helpers = {
    createUserContent(
      id: string,
      content: string | MessageContent
    ): StoredContent {
      return {
        id,
        content: { role: "user", parts: messageContentToParts(content) },
      };
    },

    createSystemContent(id: string, content: string): StoredContent {
      return {
        id,
        content: { role: "system", parts: [{ text: content }] },
      };
    },

    createModelContent(id: string, parts: Part[]): StoredContent {
      return {
        id,
        content: { role: "model", parts },
      };
    },

    createToolResponseContent(
      id: string,
      toolCallId: string,
      toolName: string,
      content: ToolMessageContent
    ): StoredContent {
      return {
        id,
        content: {
          role: "user",
          parts: [
            {
              functionResponse: {
                id: toolCallId,
                name: toolName,
                response: parseToolResponse(content),
              },
            },
          ],
        },
      };
    },

    async appendUserMessage(
      id: string,
      content: string | MessageContent
    ): Promise<void> {
      await base.append([helpers.createUserContent(id, content)]);
    },

    async appendSystemMessage(id: string, content: string): Promise<void> {
      await base.initialize();
      await base.append([helpers.createSystemContent(id, content)]);
    },

    async appendModelContent(id: string, parts: Part[]): Promise<void> {
      await base.append([helpers.createModelContent(id, parts)]);
    },

    async appendToolResult(
      id: string,
      toolCallId: string,
      toolName: string,
      content: ToolMessageContent
    ): Promise<void> {
      await base.append([
        helpers.createToolResponseContent(id, toolCallId, toolName, content),
      ]);
    },
  };

  return Object.assign(base, helpers);
}
