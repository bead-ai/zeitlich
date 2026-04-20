import type Redis from "ioredis";
import type { Content, Part } from "@google/genai";
import { createThreadManager } from "../../../lib/thread/manager";
import type {
  ProviderThreadManager,
  ThreadManagerConfig,
  ThreadManagerHooks,
} from "../../../lib/thread/types";
import type { GoogleGenAIToolResponse } from "./activities";

/** SDK-native content type for Google GenAI human messages */
export type GoogleGenAIContent = string | Part[];

/** SDK-native content type for Google GenAI system instructions */
export type GoogleGenAISystemContent = string | Part[];

/** A Content with a unique ID for idempotent Redis storage */
export interface StoredContent {
  id: string;
  content: Content;
}

export type GoogleGenAIThreadManagerHooks = ThreadManagerHooks<
  StoredContent,
  Content
>;

export interface GoogleGenAIThreadManagerConfig {
  redis: Redis;
  threadId: string;
  /** Thread key, defaults to 'messages' */
  key?: string;
  hooks?: GoogleGenAIThreadManagerHooks;
}

/** Prepared payload ready to send to the Google GenAI API */
export interface GoogleGenAIInvocationPayload {
  contents: Content[];
  systemInstruction?: Part[];
  /** Number of stored messages loaded from Redis before preparation. */
  storedLength: number;
}

/** Thread manager with Google GenAI Content convenience helpers */
export interface GoogleGenAIThreadManager extends ProviderThreadManager<
  StoredContent,
  GoogleGenAIContent,
  GoogleGenAIToolResponse,
  GoogleGenAISystemContent
> {
  appendModelContent(id: string, parts: Part[]): Promise<void>;
  prepareForInvocation(): Promise<GoogleGenAIInvocationPayload>;
}

function storedContentId(msg: StoredContent): string {
  return msg.id;
}

/** Normalise content into Part[] */
function toParts(content: GoogleGenAIContent): Part[] {
  if (typeof content === "string") {
    return [{ text: content }];
  }
  return content;
}

/** Convert a string or object into a Record suitable for functionResponse.response */
function toFunctionResponse(
  content: string | Record<string, unknown>
): Record<string, unknown> {
  if (typeof content === "object") {
    return content;
  }
  return { result: content };
}

/**
 * Merge consecutive Content objects sharing the same role.
 * The Gemini API requires alternating user/model turns; without
 * merging, multiple sequential tool-result messages would violate this.
 */
function mergeConsecutiveContents(contents: Content[]): Content[] {
  const merged: Content[] = [];
  for (const content of contents) {
    const last = merged[merged.length - 1];
    if (last && last.role === content.role) {
      last.parts = [...(last.parts ?? []), ...(content.parts ?? [])];
    } else {
      merged.push({ ...content, parts: [...(content.parts ?? [])] });
    }
  }
  return merged;
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

  const helpers: Omit<GoogleGenAIThreadManager, keyof typeof base> = {
    async appendUserMessage(
      id: string,
      content: GoogleGenAIContent
    ): Promise<void> {
      await base.append([
        {
          id,
          content: { role: "user", parts: toParts(content) },
        },
      ]);
    },

    async appendSystemMessage(
      id: string,
      content: GoogleGenAISystemContent
    ): Promise<void> {
      const parts: Part[] =
        typeof content === "string" ? [{ text: content }] : content;
      await base.initialize();
      await base.append([
        {
          id,
          content: { role: "system", parts },
        },
      ]);
    },

    async appendModelContent(id: string, parts: Part[]): Promise<void> {
      await base.append([
        {
          id,
          content: { role: "model", parts },
        },
      ]);
    },

    async appendToolResult(
      id: string,
      toolCallId: string,
      toolName: string,
      content: GoogleGenAIToolResponse
    ): Promise<void> {
      const parts: Part[] = Array.isArray(content)
        ? (content as Part[])
        : [
            {
              functionResponse: {
                id: toolCallId,
                name: toolName,
                response: toFunctionResponse(content),
              },
            },
          ];

      await base.append([
        {
          id,
          content: { role: "user", parts },
        },
      ]);
    },

    async prepareForInvocation(): Promise<GoogleGenAIInvocationPayload> {
      const stored = await base.load();
      const { onPrepareMessage, onPreparedMessage } = config.hooks ?? {};
      const mapped = onPrepareMessage
        ? stored.map((msg, i) => onPrepareMessage(msg, i, stored))
        : stored;

      let systemInstruction: Part[] | undefined;
      const conversationContents: Content[] = [];

      for (const item of mapped) {
        if (item.content.role === "system") {
          systemInstruction = item.content.parts ?? [];
        } else {
          conversationContents.push(item.content);
        }
      }

      const contents = mergeConsecutiveContents(conversationContents);
      return {
        contents: onPreparedMessage
          ? contents.map((msg, i) => onPreparedMessage(msg, i, contents))
          : contents,
        ...(systemInstruction && systemInstruction.length > 0
          ? { systemInstruction }
          : {}),
        storedLength: stored.length,
      };
    },
  };

  return Object.assign(base, helpers);
}
