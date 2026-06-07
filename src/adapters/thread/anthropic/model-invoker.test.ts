import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createAnthropicModelInvoker } from "./model-invoker";
import type { StoredMessage } from "./thread-manager";
import { THREAD_TTL_SECONDS } from "../../../lib/thread/keys";

function createMockRedis(stored: StoredMessage[]) {
  return {
    exists: vi.fn().mockResolvedValue(1),
    lRange: vi.fn().mockResolvedValue(stored.map((m) => JSON.stringify(m))),
    lTrim: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue("OK"),
    rPush: vi.fn().mockResolvedValue(1),
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

describe("createAnthropicModelInvoker thread TTL", () => {
  // The tail message is stored under `assistant-1`, so the invoker's
  // `truncateFromId(assistant-1)` trims it and re-stamps the surviving
  // list key's TTL.
  const retriedThread: StoredMessage[] = [
    { id: "msg-1", message: { role: "user", content: "hi" } },
    { id: "assistant-1", message: { role: "assistant", content: "prior" } },
  ];
  const listKey = "messages:thread:thread-1";
  const invokerConfig = {
    threadId: "thread-1",
    assistantMessageId: "assistant-1",
    state: { tools: [] } as never,
    agentName: "Agent",
  };

  it("re-stamps trimmed hot keys at the configured ttlSeconds", async () => {
    const redis = createMockRedis(retriedThread);
    const { client } = createMockClient();
    const invoker = createAnthropicModelInvoker({
      redis: redis as never,
      client: client as never,
      model: "claude-test",
      ttlSeconds: 3600,
    });

    await invoker(invokerConfig);

    expect(redis.lTrim).toHaveBeenCalledWith(listKey, 0, 0);
    expect(redis.expire).toHaveBeenCalledWith(listKey, 3600);
    expect(redis.expire).not.toHaveBeenCalledWith(listKey, THREAD_TTL_SECONDS);
  });

  it("defaults to THREAD_TTL_SECONDS when ttlSeconds is omitted", async () => {
    const redis = createMockRedis(retriedThread);
    const { client } = createMockClient();
    const invoker = createAnthropicModelInvoker({
      redis: redis as never,
      client: client as never,
      model: "claude-test",
    });

    await invoker(invokerConfig);

    expect(redis.lTrim).toHaveBeenCalledWith(listKey, 0, 0);
    expect(redis.expire).toHaveBeenCalledWith(listKey, THREAD_TTL_SECONDS);
  });
});
