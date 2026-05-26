import { describe, expect, it, vi } from "vitest";
import {
  AIMessageChunk,
  HumanMessage,
  type StoredMessage,
} from "@langchain/core/messages";
import { createLangChainModelInvoker } from "./model-invoker";

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

function createMockModel(chunks: AIMessageChunk[]) {
  const stream = vi.fn().mockImplementation(async () => ({
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  }));
  return { stream };
}

const defaultStored: StoredMessage[] = [
  new HumanMessage({ id: "msg-1", content: "hello" }).toDict(),
];

const invokerConfig = {
  threadId: "thread-1",
  assistantMessageId: "assistant-1",
  state: { tools: [] } as never,
  agentName: "TestAgent",
};

describe("LangChain model invoker — stream accumulation", () => {
  it("concatenates content chunks into a single message", async () => {
    const redis = createMockRedis(defaultStored);
    const model = createMockModel([
      new AIMessageChunk({ content: "Hello " }),
      new AIMessageChunk({ content: "world" }),
    ]);

    const invoker = createLangChainModelInvoker({
      redis: redis as never,
      model: model as never,
    });

    const result = await invoker(invokerConfig);

    expect(result.message.data.content).toBe("Hello world");
  });

  it("accumulates tool_call_chunks into rawToolCalls", async () => {
    const redis = createMockRedis(defaultStored);
    const model = createMockModel([
      new AIMessageChunk({
        content: "",
        tool_call_chunks: [
          { id: "call-1", name: "search", args: '{"q":"', index: 0 },
        ],
      }),
      new AIMessageChunk({
        content: "",
        tool_call_chunks: [{ args: 'hello"}', index: 0 }],
      }),
    ]);

    const invoker = createLangChainModelInvoker({
      redis: redis as never,
      model: model as never,
    });

    const result = await invoker(invokerConfig);

    expect(result.rawToolCalls).toEqual([
      { id: "call-1", name: "search", args: { q: "hello" } },
    ]);
  });

  it("extracts usage metadata across chunks", async () => {
    const redis = createMockRedis(defaultStored);
    const model = createMockModel([
      new AIMessageChunk({ content: "ok" }),
      new AIMessageChunk({
        content: "",
        usage_metadata: {
          input_tokens: 100,
          output_tokens: 50,
          total_tokens: 150,
          input_token_details: { cache_creation: 20, cache_read: 30 },
          output_token_details: { reasoning: 10 },
        },
      }),
    ]);

    const invoker = createLangChainModelInvoker({
      redis: redis as never,
      model: model as never,
    });

    const result = await invoker(invokerConfig);

    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      reasonTokens: 10,
      cachedWriteTokens: 20,
      cachedReadTokens: 30,
    });
  });

  it("falls back to response_metadata.usage for cache tokens", async () => {
    const redis = createMockRedis(defaultStored);
    const model = createMockModel([
      new AIMessageChunk({
        content: "ok",
        usage_metadata: {
          input_tokens: 100,
          output_tokens: 50,
          total_tokens: 150,
        },
        response_metadata: {
          usage: { cacheWriteInputTokens: 11, cacheReadInputTokens: 22 },
        },
      }),
    ]);

    const invoker = createLangChainModelInvoker({
      redis: redis as never,
      model: model as never,
    });

    const result = await invoker(invokerConfig);

    expect(result.usage?.cachedWriteTokens).toBe(11);
    expect(result.usage?.cachedReadTokens).toBe(22);
  });

  it("throws when the model returns an empty stream", async () => {
    const redis = createMockRedis(defaultStored);
    const model = createMockModel([]);

    const invoker = createLangChainModelInvoker({
      redis: redis as never,
      model: model as never,
    });

    await expect(invoker(invokerConfig)).rejects.toThrow(
      "Model returned an empty stream"
    );
  });

  it("forwards agentName, metadata, and tools to model.stream", async () => {
    const redis = createMockRedis(defaultStored);
    const model = createMockModel([new AIMessageChunk({ content: "ok" })]);

    const tools = [{ name: "lookup", description: "x", schema: {} }];

    const invoker = createLangChainModelInvoker({
      redis: redis as never,
      model: model as never,
    });

    await invoker({
      ...invokerConfig,
      metadata: { custom: "value" },
      state: { tools } as never,
    });

    const options = model.stream.mock.calls[0]?.[1];
    expect(options).toMatchObject({
      runName: "TestAgent",
      metadata: { thread_id: "TestAgent-thread-1", custom: "value" },
      tools,
    });
  });
});
