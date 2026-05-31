import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createAnthropicModelInvoker } from "./model-invoker";
import type { StoredMessage } from "./thread-manager";

function createMockRedis(stored: StoredMessage[]) {
  return {
    exists: vi.fn().mockResolvedValue(1),
    lrange: vi.fn().mockResolvedValue(stored.map((m) => JSON.stringify(m))),
    ltrim: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue("OK"),
    rpush: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    eval: vi.fn().mockResolvedValue(1),
  };
}

function createMockClient() {
  const finalMessage: Anthropic.Messages.Message = {
    id: "msg-response",
    type: "message",
    role: "assistant",
    container: null,
    model: "claude-test",
    content: [{ type: "text", text: "ok", citations: null }],
    stop_details: null,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      input_tokens: 1,
      output_tokens: 1,
      server_tool_use: null,
      service_tier: null,
      output_tokens_details: null,
    },
  };
  const stream = {
    async *[Symbol.asyncIterator]() {},
    finalMessage: vi.fn().mockResolvedValue(finalMessage),
  };
  const client = {
    messages: {
      stream: vi.fn().mockReturnValue(stream),
    },
  };
  return { client, stream };
}

describe("createAnthropicModelInvoker prompt caching", () => {
  it("sends explicit block-level cache_control by default", async () => {
    const redis = createMockRedis([
      { id: "msg-1", message: { role: "user", content: "hello" } },
    ]);
    const { client } = createMockClient();
    const invoker = createAnthropicModelInvoker({
      redis: redis as never,
      client: client as never,
      model: "claude-test",
    });

    await invoker({
      threadId: "thread-1",
      assistantMessageId: "assistant-1",
      state: { tools: [] } as never,
      agentName: "Agent",
    });

    const params = client.messages.stream.mock.calls[0]?.[0] as
      | Anthropic.MessageCreateParams
      | undefined;
    expect(params).toBeDefined();
    expect(params).not.toHaveProperty("cache_control");
    expect(params?.messages[0]?.content).toEqual([
      {
        type: "text",
        text: "hello",
        cache_control: { type: "ephemeral", ttl: "5m" },
      },
    ]);
  });

  it("can disable prompt caching", async () => {
    const redis = createMockRedis([
      { id: "msg-1", message: { role: "user", content: "hello" } },
    ]);
    const { client } = createMockClient();
    const invoker = createAnthropicModelInvoker({
      redis: redis as never,
      client: client as never,
      model: "claude-test",
      promptCache: false,
    });

    await invoker({
      threadId: "thread-1",
      assistantMessageId: "assistant-1",
      state: { tools: [] } as never,
      agentName: "Agent",
    });

    const params = client.messages.stream.mock.calls[0]?.[0] as
      | Anthropic.MessageCreateParams
      | undefined;
    expect(params?.messages[0]?.content).toBe("hello");
  });
});
