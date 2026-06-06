import { describe, expect, it, vi } from "vitest";
import type { GenerateContentResponse, Part } from "@google/genai";
import { createGoogleGenAIAdapter } from "./activities";
import type { StoredContent } from "./thread-manager";
import { THREAD_TTL_SECONDS } from "../../../lib/thread/keys";

function createMockRedis(stored: StoredContent[]) {
  return {
    exists: vi.fn().mockResolvedValue(1),
    lRange: vi.fn().mockResolvedValue(stored.map((m) => JSON.stringify(m))),
    lTrim: vi.fn().mockResolvedValue("OK"),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue("OK"),
    rPush: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    eval: vi.fn().mockResolvedValue(1),
  };
}

function createMockClient(parts: Part[] = [{ text: "ok" }]) {
  const chunk: Partial<GenerateContentResponse> = {
    candidates: [{ content: { role: "model", parts } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  };
  return {
    models: {
      generateContentStream: vi.fn().mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          yield chunk;
        },
      }),
    },
    caches: {
      create: vi.fn().mockResolvedValue({ name: "cached-content-ref" }),
    },
  };
}

// Tail stored under the `assistantMessageId`, so the invoker's
// `truncateFromId` trims it and re-stamps the surviving list key's TTL.
const retriedThread: StoredContent[] = [
  { id: "msg-1", content: { role: "user", parts: [{ text: "hi" }] } },
  { id: "assistant-1", content: { role: "model", parts: [{ text: "prior" }] } },
];
const listKey = "messages:thread:thread-1";
const metaKey = "messages:meta:thread:thread-1";
const invokerCall = {
  threadId: "thread-1",
  assistantMessageId: "assistant-1",
  state: { tools: [] } as never,
  agentName: "TestAgent",
};

describe("createGoogleGenAIAdapter — TTL propagation", () => {
  it("forwards adapter ttlSeconds to a created invoker's writes", async () => {
    const redis = createMockRedis(retriedThread);
    const client = createMockClient();
    const adapter = createGoogleGenAIAdapter({
      redis: redis as never,
      ttlSeconds: 3600,
    });

    await adapter.createModelInvoker(
      "gemini-2.5-flash",
      client as never
    )(invokerCall);

    expect(redis.expire).toHaveBeenCalledWith(listKey, 3600);
    expect(redis.expire).not.toHaveBeenCalledWith(listKey, THREAD_TTL_SECONDS);
  });

  it("forwards adapter ttlSeconds to the default invoker", async () => {
    const redis = createMockRedis(retriedThread);
    const client = createMockClient();
    const adapter = createGoogleGenAIAdapter({
      redis: redis as never,
      client: client as never,
      model: "gemini-2.5-flash",
      ttlSeconds: 3600,
    });

    await adapter.invoker(invokerCall);

    expect(redis.expire).toHaveBeenCalledWith(listKey, 3600);
  });

  it("forwards adapter ttlSeconds to thread-op writes", async () => {
    const redis = createMockRedis([]);
    const adapter = createGoogleGenAIAdapter({
      redis: redis as never,
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
    const adapter = createGoogleGenAIAdapter({ redis: redis as never });

    await adapter.createModelInvoker(
      "gemini-2.5-flash",
      client as never
    )(invokerCall);

    expect(redis.expire).toHaveBeenCalledWith(listKey, THREAD_TTL_SECONDS);
  });
});

describe("createGoogleGenAIAdapter — cache/config forwarding", () => {
  it("forwards adapter cache config to the invoker", async () => {
    const multiThread: StoredContent[] = [
      { id: "m1", content: { role: "user", parts: [{ text: "a" }] } },
      { id: "m2", content: { role: "model", parts: [{ text: "b" }] } },
      { id: "m3", content: { role: "user", parts: [{ text: "c" }] } },
    ];
    const redis = createMockRedis(multiThread);
    const client = createMockClient();
    const adapter = createGoogleGenAIAdapter({
      redis: redis as never,
      cache: { splitIndex: 1 },
    });

    await adapter.createModelInvoker(
      "gemini-2.5-flash",
      client as never
    )(invokerCall);

    expect(client.caches.create).toHaveBeenCalledOnce();
  });

  it("forwards adapter generationConfig to generateContentStream", async () => {
    const redis = createMockRedis([
      { id: "m1", content: { role: "user", parts: [{ text: "a" }] } },
    ]);
    const client = createMockClient();
    const adapter = createGoogleGenAIAdapter({
      redis: redis as never,
      generationConfig: { temperature: 0.5 },
    });

    await adapter.createModelInvoker(
      "gemini-2.5-flash",
      client as never
    )(invokerCall);

    const streamCall = client.models.generateContentStream.mock.calls[0]?.[0];
    expect(streamCall.config.temperature).toBe(0.5);
  });
});
