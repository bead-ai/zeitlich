import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createAnthropicAdapter } from "./activities";
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
  return { messages: { stream: vi.fn().mockReturnValue(stream) } };
}

// Tail stored under the `assistantMessageId`, so the invoker's
// `truncateFromId` trims it and re-stamps the surviving list key's TTL.
const retriedThread: StoredMessage[] = [
  { id: "msg-1", message: { role: "user", content: "hi" } },
  { id: "assistant-1", message: { role: "assistant", content: "prior" } },
];
const listKey = "messages:thread:thread-1";
const metaKey = "messages:meta:thread:thread-1";
const invokerCall = {
  threadId: "thread-1",
  assistantMessageId: "assistant-1",
  state: { tools: [] } as never,
  agentName: "TestAgent",
};

describe("createAnthropicAdapter — TTL propagation", () => {
  it("forwards adapter ttlSeconds to a created invoker's writes", async () => {
    const redis = createMockRedis(retriedThread);
    const client = createMockClient();
    const adapter = createAnthropicAdapter({
      redis: redis as never,
      client: client as never,
      ttlSeconds: 3600,
    });

    await adapter.createModelInvoker("claude-test")(invokerCall);

    expect(redis.expire).toHaveBeenCalledWith(listKey, 3600);
    expect(redis.expire).not.toHaveBeenCalledWith(listKey, THREAD_TTL_SECONDS);
  });

  it("forwards adapter ttlSeconds to thread-op writes", async () => {
    const redis = createMockRedis([]);
    const client = createMockClient();
    const adapter = createAnthropicAdapter({
      redis: redis as never,
      client: client as never,
      ttlSeconds: 3600,
    });
    const acts = adapter.createActivities() as unknown as Record<
      string,
      (threadId: string, threadKey?: string) => Promise<void>
    >;
    const initialize = Object.entries(acts).find(([k]) =>
      k.endsWith("InitializeThread")
    )?.[1];
    if (!initialize) throw new Error("initializeThread activity not found");

    await initialize("thread-1");

    expect(redis.set).toHaveBeenCalledWith(metaKey, "1", { EX: 3600 });
  });

  it("defaults to THREAD_TTL_SECONDS when adapter ttlSeconds is omitted", async () => {
    const redis = createMockRedis(retriedThread);
    const client = createMockClient();
    const adapter = createAnthropicAdapter({
      redis: redis as never,
      client: client as never,
    });

    await adapter.createModelInvoker("claude-test")(invokerCall);

    expect(redis.expire).toHaveBeenCalledWith(listKey, THREAD_TTL_SECONDS);
  });
});
