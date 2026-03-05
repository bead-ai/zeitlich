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
export interface GoogleGenAIThreadManager
  extends BaseThreadManager<StoredContent> {
  createUserContent(content: string | MessageContent): StoredContent;
  createSystemContent(content: string): StoredContent;
  createModelContent(parts: Part[]): StoredContent;
  createToolResponseContent(
    toolCallId: string,
    toolName: string,
    content: ToolMessageContent,
  ): StoredContent;
  appendUserMessage(content: string | MessageContent): Promise<void>;
  appendSystemMessage(content: string): Promise<void>;
  appendModelContent(parts: Part[]): Promise<void>;
  appendToolResult(
    toolCallId: string,
    toolName: string,
    content: ToolMessageContent,
  ): Promise<void>;
}

function storedContentId(msg: StoredContent): string {
  return msg.id;
}

/** Convert zeitlich MessageContent to Google GenAI Part[] */
export function messageContentToParts(
  content: string | MessageContent,
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
  content: ToolMessageContent,
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
  config: GoogleGenAIThreadManagerConfig,
): GoogleGenAIThreadManager {
  const baseConfig: ThreadManagerConfig<StoredContent> = {
    redis: config.redis,
    threadId: config.threadId,
    key: config.key,
    idOf: storedContentId,
  };

  const base = createThreadManager(baseConfig);

  const helpers = {
    createUserContent(content: string | MessageContent): StoredContent {
      return {
        id: crypto.randomUUID(),
        content: { role: "user", parts: messageContentToParts(content) },
      };
    },

    createSystemContent(content: string): StoredContent {
      return {
        id: crypto.randomUUID(),
        content: { role: "system", parts: [{ text: content }] },
      };
    },

    createModelContent(parts: Part[]): StoredContent {
      return {
        id: crypto.randomUUID(),
        content: { role: "model", parts },
      };
    },

    createToolResponseContent(
      toolCallId: string,
      toolName: string,
      content: ToolMessageContent,
    ): StoredContent {
      return {
        id: crypto.randomUUID(),
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

    async appendUserMessage(content: string | MessageContent): Promise<void> {
      await base.append([helpers.createUserContent(content)]);
    },

    async appendSystemMessage(content: string): Promise<void> {
      await base.initialize();
      await base.append([helpers.createSystemContent(content)]);
    },

    async appendModelContent(parts: Part[]): Promise<void> {
      await base.append([helpers.createModelContent(parts)]);
    },

    async appendToolResult(
      toolCallId: string,
      toolName: string,
      content: ToolMessageContent,
    ): Promise<void> {
      await base.append([
        helpers.createToolResponseContent(toolCallId, toolName, content),
      ]);
    },
  };

  return Object.assign(base, helpers);
}
