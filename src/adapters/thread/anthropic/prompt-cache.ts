import type Anthropic from "@anthropic-ai/sdk";

export interface AnthropicPromptCacheOptions {
  /** TTL for the cache checkpoint. Defaults to 5m. */
  ttl?: Anthropic.Messages.CacheControlEphemeral["ttl"];
  /** Claude models support at most 4 cache breakpoints per request. */
  maxBreakpoints?: number;
}

export type AnthropicPromptCacheConfig = boolean | AnthropicPromptCacheOptions;

interface PromptCachePayload {
  messages: Anthropic.Messages.MessageParam[];
  system?: string | Anthropic.Messages.TextBlockParam[];
  tools?: Anthropic.Messages.Tool[];
}

type CacheControl = Anthropic.Messages.CacheControlEphemeral;
type CacheableRecord = Record<string, unknown> & {
  cache_control?: CacheControl | null;
};

const DEFAULT_MAX_CACHE_BREAKPOINTS = 4;
const UNCACHEABLE_BLOCK_TYPES = new Set(["thinking", "redacted_thinking"]);

/**
 * Resolve model-invoker prompt-cache config. Undefined means the default:
 * enabled with an explicit 5 minute TTL.
 */
export function resolvePromptCacheOptions(
  promptCache?: AnthropicPromptCacheConfig
): AnthropicPromptCacheOptions | undefined {
  if (promptCache === false) return undefined;
  if (promptCache === true || promptCache === undefined) return {};
  return promptCache;
}

/**
 * Add an explicit `cache_control` marker to the final cacheable message block.
 *
 * This intentionally uses block-level cache control rather than Anthropic's
 * top-level automatic `cache_control` field because Amazon Bedrock does not
 * support the top-level form. The block-level shape is accepted by both the
 * Anthropic Messages API and Bedrock InvokeModel for Anthropic Claude models.
 */
export function addPromptCacheControl<TPayload extends PromptCachePayload>(
  payload: TPayload,
  options: AnthropicPromptCacheOptions = {}
): TPayload {
  const maxBreakpoints =
    options.maxBreakpoints ?? DEFAULT_MAX_CACHE_BREAKPOINTS;
  if (maxBreakpoints <= 0) return payload;

  if (countCacheControls(payload) >= maxBreakpoints) return payload;

  const cacheControl: CacheControl = {
    type: "ephemeral",
    ttl: options.ttl ?? "5m",
  };
  const messages = addCacheControlToLastMessageBlock(
    payload.messages,
    cacheControl
  );

  if (messages === payload.messages) return payload;
  return { ...payload, messages };
}

function addCacheControlToLastMessageBlock(
  messages: Anthropic.Messages.MessageParam[],
  cacheControl: CacheControl
): Anthropic.Messages.MessageParam[] {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex--
  ) {
    const message = messages[messageIndex];
    if (!message) continue;

    if (typeof message.content === "string") {
      if (message.content.length === 0) continue;
      return replaceMessage(messages, messageIndex, {
        ...message,
        content: [
          { type: "text", text: message.content, cache_control: cacheControl },
        ],
      });
    }

    if (!Array.isArray(message.content)) continue;

    for (
      let blockIndex = message.content.length - 1;
      blockIndex >= 0;
      blockIndex--
    ) {
      const block = message.content[blockIndex];
      if (!isCacheableContentBlock(block)) continue;
      if (hasCacheControl(block)) return messages;

      const content = [...message.content];
      content[blockIndex] = {
        ...(block as Record<string, unknown>),
        cache_control: cacheControl,
      } as Anthropic.Messages.ContentBlockParam;
      return replaceMessage(messages, messageIndex, { ...message, content });
    }
  }

  return messages;
}

function replaceMessage(
  messages: Anthropic.Messages.MessageParam[],
  index: number,
  message: Anthropic.Messages.MessageParam
): Anthropic.Messages.MessageParam[] {
  const next = [...messages];
  next[index] = message;
  return next;
}

function isCacheableContentBlock(
  block: Anthropic.Messages.ContentBlockParam | undefined
): block is Anthropic.Messages.ContentBlockParam & CacheableRecord {
  if (!isRecord(block)) return false;
  const type = typeof block.type === "string" ? block.type : undefined;
  if (type && UNCACHEABLE_BLOCK_TYPES.has(type)) return false;
  if (type === "text" && block.text === "") return false;
  return true;
}

function countCacheControls(payload: PromptCachePayload): number {
  let count = 0;

  for (const tool of payload.tools ?? []) {
    if (hasCacheControl(tool)) count++;
  }

  if (Array.isArray(payload.system)) {
    for (const block of payload.system) {
      if (hasCacheControl(block)) count++;
    }
  }

  for (const message of payload.messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (hasCacheControl(block)) count++;
    }
  }

  return count;
}

function hasCacheControl(value: unknown): value is CacheableRecord {
  return isRecord(value) && value.cache_control != null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
