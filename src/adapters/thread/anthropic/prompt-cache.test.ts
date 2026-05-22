import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  addPromptCacheControl,
  resolvePromptCacheOptions,
} from "./prompt-cache";

function firstContentBlock(
  message: Anthropic.Messages.MessageParam
): Record<string, unknown> {
  if (!Array.isArray(message.content)) {
    throw new Error("Expected array content");
  }
  const block = message.content[0];
  if (!block || typeof block !== "object") {
    throw new Error("Expected content block");
  }
  return block as unknown as Record<string, unknown>;
}

function messageAt(
  messages: Anthropic.Messages.MessageParam[],
  index: number
): Anthropic.Messages.MessageParam {
  const message = messages[index];
  if (!message) throw new Error(`Expected message at index ${String(index)}`);
  return message;
}

describe("Anthropic prompt cache helpers", () => {
  it("enables prompt caching by default", () => {
    expect(resolvePromptCacheOptions()).toEqual({});
  });

  it("can be disabled", () => {
    expect(resolvePromptCacheOptions(false)).toBeUndefined();
  });

  it("adds Bedrock-compatible block-level cache_control to the last message", () => {
    const payload = {
      messages: [{ role: "user" as const, content: "hello" }],
    };

    const result = addPromptCacheControl(payload);
    const block = firstContentBlock(messageAt(result.messages, 0));

    expect(block).toEqual({
      type: "text",
      text: "hello",
      cache_control: { type: "ephemeral", ttl: "5m" },
    });
    expect("cache_control" in result).toBe(false);
  });

  it("supports a 1h TTL", () => {
    const result = addPromptCacheControl(
      {
        messages: [
          {
            role: "user" as const,
            content: [{ type: "text" as const, text: "hello" }],
          },
        ],
      },
      { ttl: "1h" }
    );

    expect(
      firstContentBlock(messageAt(result.messages, 0)).cache_control
    ).toEqual({
      type: "ephemeral",
      ttl: "1h",
    });
  });

  it("does not add a fifth cache breakpoint", () => {
    const cacheControl = { type: "ephemeral" as const };
    const result = addPromptCacheControl({
      system: [
        { type: "text" as const, text: "system", cache_control: cacheControl },
      ],
      tools: [
        {
          name: "tool",
          description: "A test tool",
          input_schema: { type: "object", properties: {} },
          cache_control: cacheControl,
        },
      ],
      messages: [
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: "1", cache_control: cacheControl },
            { type: "text" as const, text: "2", cache_control: cacheControl },
            { type: "text" as const, text: "latest" },
          ],
        },
      ],
    });

    const latest = (
      messageAt(result.messages, 0).content as unknown as Array<
        Record<string, unknown>
      >
    )[2];
    expect(latest?.cache_control).toBeUndefined();
  });

  it("preserves an existing cache marker on the last cacheable block", () => {
    const cacheControl = { type: "ephemeral" as const, ttl: "1h" as const };
    const payload = {
      messages: [
        {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: "hello",
              cache_control: cacheControl,
            },
          ],
        },
      ],
    };

    const result = addPromptCacheControl(payload, { ttl: "5m" });

    expect(result).toBe(payload);
    expect(
      firstContentBlock(messageAt(result.messages, 0)).cache_control
    ).toEqual(cacheControl);
  });
});
