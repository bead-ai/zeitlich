import { describe, expect, it, vi } from "vitest";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { createLangChainModelInvoker } from "./model-invoker";
import { THREAD_TTL_SECONDS } from "../../../lib/thread/keys";

function createMockRedis(stored: unknown[]) {
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

function createMockModel() {
  const response = {
    tool_calls: [],
    response_metadata: {},
    usage_metadata: { input_tokens: 1, output_tokens: 1 },
    toDict: () => ({ type: "ai", data: { content: "ok" } }),
  };
  return { invoke: vi.fn().mockResolvedValue(response) };
}

describe("createLangChainModelInvoker thread TTL", () => {
  // The tail message is stored under `assistant-1`, so the invoker's
  // `truncateFromId(assistant-1)` trims it and re-stamps the surviving
  // list key's TTL.
  const retriedThread = [
    new HumanMessage({ id: "msg-1", content: "hi" }).toDict(),
    new AIMessage({ id: "assistant-1", content: "prior" }).toDict(),
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
    const model = createMockModel();
    const invoker = createLangChainModelInvoker({
      redis: redis as never,
      model: model as never,
      ttlSeconds: 3600,
    });

    await invoker(invokerConfig);

    expect(redis.lTrim).toHaveBeenCalledWith(listKey, 0, 0);
    expect(redis.expire).toHaveBeenCalledWith(listKey, 3600);
    expect(redis.expire).not.toHaveBeenCalledWith(listKey, THREAD_TTL_SECONDS);
  });

  it("defaults to THREAD_TTL_SECONDS when ttlSeconds is omitted", async () => {
    const redis = createMockRedis(retriedThread);
    const model = createMockModel();
    const invoker = createLangChainModelInvoker({
      redis: redis as never,
      model: model as never,
    });

    await invoker(invokerConfig);

    expect(redis.lTrim).toHaveBeenCalledWith(listKey, 0, 0);
    expect(redis.expire).toHaveBeenCalledWith(listKey, THREAD_TTL_SECONDS);
  });
});
