import type Redis from "ioredis";
import type Anthropic from "@anthropic-ai/sdk";
import type { JsonValue } from "../../../lib/state/types";
import {
  createThreadManager,
  type ProviderThreadManager,
  type ThreadManagerConfig,
  type ThreadManagerHooks,
} from "../../../lib/thread";

/** SDK-native content type for Anthropic human messages */
export type AnthropicContent =
  | string
  | Anthropic.Messages.ContentBlockParam[];

/** A MessageParam with a unique ID for idempotent Redis storage */
export interface StoredMessage {
  id: string;
  message: Anthropic.Messages.MessageParam;
  /** System messages are stored separately since Anthropic passes them via config */
  isSystem?: boolean;
}

export type AnthropicThreadManagerHooks = ThreadManagerHooks<StoredMessage>;

export interface AnthropicThreadManagerConfig {
  redis: Redis;
  threadId: string;
  /** Thread key, defaults to 'messages' */
  key?: string;
  hooks?: AnthropicThreadManagerHooks;
}

/** Prepared payload ready to send to the Anthropic API */
export interface AnthropicInvocationPayload {
  messages: Anthropic.Messages.MessageParam[];
  system?: string;
}

/** Thread manager with Anthropic MessageParam convenience helpers */
export interface AnthropicThreadManager
  extends ProviderThreadManager<StoredMessage, AnthropicContent> {
  appendAssistantMessage(
    id: string,
    content: Anthropic.Messages.ContentBlock[],
  ): Promise<void>;
  prepareForInvocation(): Promise<AnthropicInvocationPayload>;
}

function storedMessageId(msg: StoredMessage): string {
  return msg.id;
}

/** Normalise content into an array of ContentBlockParam */
function toContentBlocks(
  content: AnthropicContent,
): Anthropic.Messages.ContentBlockParam[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return content;
}

/**
 * Merge consecutive messages with the same role.
 * The Anthropic API requires alternating user/assistant turns; without
 * merging, multiple sequential tool-result messages would violate this.
 */
function mergeConsecutiveMessages(
  messages: Anthropic.Messages.MessageParam[],
): Anthropic.Messages.MessageParam[] {
  const merged: Anthropic.Messages.MessageParam[] = [];
  for (const msg of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) {
      const lastContent = Array.isArray(last.content)
        ? last.content
        : [{ type: "text" as const, text: last.content }];
      const msgContent = Array.isArray(msg.content)
        ? msg.content
        : [{ type: "text" as const, text: msg.content }];
      last.content = [...lastContent, ...msgContent];
    } else {
      merged.push({
        ...msg,
        content: Array.isArray(msg.content)
          ? [...msg.content]
          : msg.content,
      });
    }
  }
  return merged;
}

/**
 * Creates an Anthropic-specific thread manager that stores StoredMessage
 * instances in Redis and provides convenience helpers for creating and
 * appending typed messages.
 */
export function createAnthropicThreadManager(
  config: AnthropicThreadManagerConfig,
): AnthropicThreadManager {
  const baseConfig: ThreadManagerConfig<StoredMessage> = {
    redis: config.redis,
    threadId: config.threadId,
    key: config.key,
    idOf: storedMessageId,
  };

  const base = createThreadManager(baseConfig);

  const helpers: Omit<AnthropicThreadManager, keyof typeof base> = {
    async appendUserMessage(
      id: string,
      content: AnthropicContent,
    ): Promise<void> {
      await base.append([{
        id,
        message: { role: "user", content: toContentBlocks(content) },
      }]);
    },

    async appendSystemMessage(id: string, content: string): Promise<void> {
      await base.initialize();
      await base.append([{
        id,
        message: { role: "user", content },
        isSystem: true,
      }]);
    },

    async appendAssistantMessage(
      id: string,
      content: Anthropic.Messages.ContentBlock[],
    ): Promise<void> {
      await base.append([{
        id,
        message: {
          role: "assistant",
          content: content as unknown as Anthropic.Messages.ContentBlockParam[],
        },
      }]);
    },

    async appendToolResult(
      id: string,
      toolCallId: string,
      _toolName: string,
      content: JsonValue,
    ): Promise<void> {
      const toolContent =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? (content as unknown as Anthropic.Messages.ToolResultBlockParam["content"])
            : JSON.stringify(content);
      await base.append([{
        id,
        message: {
          role: "user",
          content: [{
            type: "tool_result" as const,
            tool_use_id: toolCallId,
            content: toolContent,
          }],
        },
      }]);
    },

    async prepareForInvocation(): Promise<AnthropicInvocationPayload> {
      const stored = await base.load();
      const onPrepareMessage = config.hooks?.onPrepareMessage;
      const mapped = onPrepareMessage
        ? stored.map((msg, i) => onPrepareMessage(msg, i, stored))
        : stored;

      let system: string | undefined;
      const conversationMessages: Anthropic.Messages.MessageParam[] = [];

      for (const item of mapped) {
        if (item.isSystem) {
          system =
            typeof item.message.content === "string"
              ? item.message.content
              : undefined;
        } else {
          conversationMessages.push(item.message);
        }
      }

      return {
        messages: mergeConsecutiveMessages(conversationMessages),
        ...(system ? { system } : {}),
      };
    },
  };

  return Object.assign(base, helpers);
}
