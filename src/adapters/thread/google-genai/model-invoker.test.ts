import { describe, expect, it, vi } from "vitest";
import {
  FunctionCallingConfigMode,
  type Content,
  type GenerateContentResponse,
  type Part,
} from "@google/genai";
import { createGoogleGenAIModelInvoker } from "./model-invoker";
import type { StoredContent } from "./thread-manager";
import type { AgentResponse } from "../../../lib/model";
import { THREAD_TTL_SECONDS } from "../../../lib/thread/keys";

const textReply: Part[] = [{ text: "ok" }];

function createMockRedis(
  stored: StoredContent[],
  extra?: Record<string, string>
) {
  return {
    exists: vi.fn().mockResolvedValue(1),
    lRange: vi.fn().mockResolvedValue(stored.map((m) => JSON.stringify(m))),
    lTrim: vi.fn().mockResolvedValue("OK"),
    get: vi
      .fn()
      .mockImplementation((key: string) =>
        Promise.resolve(extra?.[key] ?? null)
      ),
    del: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue("OK"),
    rPush: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    eval: vi.fn().mockResolvedValue(1),
  };
}

function createMockClient(parts: Part[] = textReply) {
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

const defaultStored: StoredContent[] = [
  {
    id: "msg-1",
    content: { role: "user", parts: [{ text: "classify these files" }] },
  },
];

const invokerConfig = {
  threadId: "thread-1",
  assistantMessageId: "assistant-1",
  state: { tools: [] } as never,
  agentName: "TestAgent",
};

function invoke(parts: Part[]): Promise<AgentResponse<Content>> {
  const redis = createMockRedis(defaultStored);
  const client = createMockClient(parts);

  const invoker = createGoogleGenAIModelInvoker({
    redis: redis as never,
    client: client as never,
    model: "gemini-2.5-flash",
  });

  return invoker(invokerConfig);
}

describe("Google GenAI model invoker — function call IDs", () => {
  it("assigns synthetic IDs when Gemini omits them", async () => {
    const result = await invoke([
      { functionCall: { name: "classifyFile", args: { index: 0 } } },
      { functionCall: { name: "classifyFile", args: { index: 1 } } },
    ]);

    expect(result.rawToolCalls).toHaveLength(2);
    for (const tc of result.rawToolCalls) {
      expect(tc.id).toBeDefined();
      expect(tc.id).not.toBe("");
    }
  });

  it("preserves existing IDs from Gemini when present", async () => {
    const result = await invoke([
      {
        functionCall: {
          id: "gemini-abc123",
          name: "lookupFile",
          args: { path: "/a" },
        },
      },
    ]);

    expect(result.rawToolCalls[0]?.id).toBe("gemini-abc123");
  });

  it("generates unique IDs across multiple function calls", async () => {
    const parts: Part[] = Array.from({ length: 5 }, (_, i) => ({
      functionCall: { name: "inspect", args: { index: i } },
    }));

    const result = await invoke(parts);

    const ids = result.rawToolCalls.map((tc) => tc.id);
    expect(new Set(ids).size).toBe(5);
  });

  it("matches IDs between message parts and rawToolCalls", async () => {
    const result = await invoke([
      { functionCall: { name: "toolA", args: {} } },
      { functionCall: { name: "toolB", args: {} } },
    ]);

    const partIds = result.message.parts
      ?.filter((p) => p.functionCall)
      .map((p) => p.functionCall?.id);
    const rawIds = result.rawToolCalls.map((tc) => tc.id);

    expect(partIds).toEqual(rawIds);
  });

  it("handles a mix of parts with and without existing IDs", async () => {
    const result = await invoke([
      { functionCall: { id: "existing-id", name: "toolA", args: {} } },
      { functionCall: { name: "toolB", args: {} } },
      { text: "some reasoning text" },
    ]);

    expect(result.rawToolCalls).toHaveLength(2);
    expect(result.rawToolCalls[0]?.id).toBe("existing-id");
    expect(result.rawToolCalls[1]?.id).toBeDefined();
    expect(result.rawToolCalls[1]?.id).not.toBe("");
    expect(result.rawToolCalls[1]?.id).not.toBe("existing-id");
  });
});

describe("Google GenAI model invoker — context caching", () => {
  const multiMessageThread: StoredContent[] = [
    {
      id: "msg-1",
      content: {
        role: "user",
        parts: [{ inlineData: { data: "base64img", mimeType: "image/png" } }],
      },
    },
    {
      id: "msg-2",
      content: { role: "model", parts: [{ text: "I see the image" }] },
    },
    {
      id: "msg-3",
      content: { role: "user", parts: [{ text: "classify it" }] },
    },
  ];

  it("creates a cache and sends only live contents when contents exceed splitIndex", async () => {
    const redis = createMockRedis(multiMessageThread);
    const client = createMockClient();

    const invoker = createGoogleGenAIModelInvoker({
      redis: redis as never,
      client: client as never,
      model: "gemini-2.5-flash",
      cache: { splitIndex: 1 },
    });

    await invoker(invokerConfig);

    expect(client.caches.create).toHaveBeenCalledOnce();
    const cacheCall = client.caches.create.mock.calls[0]?.[0];
    expect(cacheCall.model).toBe("gemini-2.5-flash");
    expect(cacheCall.config.contents).toHaveLength(1);
    expect(cacheCall.config.ttl).toBe("300s");

    const streamCall = client.models.generateContentStream.mock.calls[0]?.[0];
    expect(streamCall.contents).toHaveLength(2);
    expect(streamCall.config.cachedContent).toBe("cached-content-ref");
    expect(streamCall.config.systemInstruction).toBeUndefined();
    expect(streamCall.config.tools).toBeUndefined();
  });

  it("skips caching when contents.length <= splitIndex", async () => {
    const redis = createMockRedis(defaultStored);
    const client = createMockClient();

    const invoker = createGoogleGenAIModelInvoker({
      redis: redis as never,
      client: client as never,
      model: "gemini-2.5-flash",
      cache: { splitIndex: 1 },
    });

    await invoker(invokerConfig);

    expect(client.caches.create).not.toHaveBeenCalled();
    const streamCall = client.models.generateContentStream.mock.calls[0]?.[0];
    expect(streamCall.contents).toHaveLength(1);
    expect(streamCall.config.cachedContent).toBeUndefined();
  });

  it("uses custom TTL", async () => {
    const redis = createMockRedis(multiMessageThread);
    const client = createMockClient();

    const invoker = createGoogleGenAIModelInvoker({
      redis: redis as never,
      client: client as never,
      model: "gemini-2.5-flash",
      cache: { splitIndex: 1, ttlSeconds: 600 },
    });

    await invoker(invokerConfig);

    const cacheCall = client.caches.create.mock.calls[0]?.[0];
    expect(cacheCall.config.ttl).toBe("600s");
  });

  it("moves toolConfig into cache and clears it from live request", async () => {
    const redis = createMockRedis(multiMessageThread);
    const client = createMockClient();

    const toolConfig = {
      functionCallingConfig: { mode: FunctionCallingConfigMode.ANY },
    };

    const invoker = createGoogleGenAIModelInvoker({
      redis: redis as never,
      client: client as never,
      model: "gemini-2.5-flash",
      cache: { splitIndex: 1 },
      config: { toolConfig },
    });

    await invoker(invokerConfig);

    const cacheCall = client.caches.create.mock.calls[0]?.[0];
    expect(cacheCall.config.toolConfig).toEqual(toolConfig);

    const streamCall = client.models.generateContentStream.mock.calls[0]?.[0];
    expect(streamCall.config.toolConfig).toBeUndefined();
  });

  it("skips caching when splitIndex is 0", async () => {
    const redis = createMockRedis(multiMessageThread);
    const client = createMockClient();

    const invoker = createGoogleGenAIModelInvoker({
      redis: redis as never,
      client: client as never,
      model: "gemini-2.5-flash",
      cache: { splitIndex: 0 },
    });

    await invoker(invokerConfig);

    expect(client.caches.create).not.toHaveBeenCalled();
    const streamCall = client.models.generateContentStream.mock.calls[0]?.[0];
    expect(streamCall.config.cachedContent).toBeUndefined();
  });

  it("reuses cached content name from Redis instead of creating a new cache", async () => {
    const redis = createMockRedis(multiMessageThread, {
      "messages:gemini-cache:gemini-2.5-flash:1:thread:thread-1":
        "cachedContents/existing",
    });
    const client = createMockClient();

    const invoker = createGoogleGenAIModelInvoker({
      redis: redis as never,
      client: client as never,
      model: "gemini-2.5-flash",
      cache: { splitIndex: 1 },
    });

    await invoker(invokerConfig);

    expect(client.caches.create).not.toHaveBeenCalled();
    const streamCall = client.models.generateContentStream.mock.calls[0]?.[0];
    expect(streamCall.config.cachedContent).toBe("cachedContents/existing");
    expect(streamCall.contents).toHaveLength(2);
  });

  it("stores cache name in Redis after creation", async () => {
    const redis = createMockRedis(multiMessageThread);
    const client = createMockClient();

    const invoker = createGoogleGenAIModelInvoker({
      redis: redis as never,
      client: client as never,
      model: "gemini-2.5-flash",
      cache: { splitIndex: 1, ttlSeconds: 600 },
    });

    await invoker(invokerConfig);

    expect(client.caches.create).toHaveBeenCalledOnce();
    const setCall = redis.set.mock.calls.find(
      (c: string[]) =>
        c[0] === "messages:gemini-cache:gemini-2.5-flash:1:thread:thread-1"
    );
    expect(setCall).toBeDefined();
    expect(setCall?.[1]).toBe("cached-content-ref");
    expect(setCall?.[2]).toEqual({ EX: 595 });
  });

  it("reports cachedWriteTokens from cache creation", async () => {
    const redis = createMockRedis(multiMessageThread);
    const client = createMockClient();
    client.caches.create.mockResolvedValue({
      name: "cached-content-ref",
      usageMetadata: { totalTokenCount: 4200 },
    });

    const invoker = createGoogleGenAIModelInvoker({
      redis: redis as never,
      client: client as never,
      model: "gemini-2.5-flash",
      cache: { splitIndex: 1 },
    });

    const result = await invoker(invokerConfig);

    expect(result.usage?.cachedWriteTokens).toBe(4200);
  });
});

describe("Google GenAI model invoker — thread TTL", () => {
  // A thread whose tail is a prior attempt's assistant message stored
  // under `assistant-1`, so the invoker's `truncateFromId(assistant-1)`
  // trims it and re-stamps the surviving list key's TTL.
  const retriedThread: StoredContent[] = [
    { id: "msg-1", content: { role: "user", parts: [{ text: "hi" }] } },
    {
      id: "assistant-1",
      content: { role: "model", parts: [{ text: "prior attempt" }] },
    },
  ];
  const listKey = "messages:thread:thread-1";

  it("re-stamps trimmed hot keys at the configured ttlSeconds", async () => {
    const redis = createMockRedis(retriedThread);
    const client = createMockClient();

    const invoker = createGoogleGenAIModelInvoker({
      redis: redis as never,
      client: client as never,
      model: "gemini-2.5-flash",
      ttlSeconds: 3600,
    });

    await invoker(invokerConfig);

    expect(redis.lTrim).toHaveBeenCalledWith(listKey, 0, 0);
    expect(redis.expire).toHaveBeenCalledWith(listKey, 3600);
    expect(redis.expire).not.toHaveBeenCalledWith(listKey, THREAD_TTL_SECONDS);
  });

  it("defaults to THREAD_TTL_SECONDS when ttlSeconds is omitted", async () => {
    const redis = createMockRedis(retriedThread);
    const client = createMockClient();

    const invoker = createGoogleGenAIModelInvoker({
      redis: redis as never,
      client: client as never,
      model: "gemini-2.5-flash",
    });

    await invoker(invokerConfig);

    expect(redis.lTrim).toHaveBeenCalledWith(listKey, 0, 0);
    expect(redis.expire).toHaveBeenCalledWith(listKey, THREAD_TTL_SECONDS);
  });
});
