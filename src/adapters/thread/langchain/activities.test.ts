import { describe, expect, it, vi } from "vitest";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { createLangChainAdapter } from "./activities";
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

// Tail stored under the `assistantMessageId`, so the invoker's
// `truncateFromId` trims it and re-stamps the surviving list key's TTL.
const retriedThread = [
  new HumanMessage({ id: "msg-1", content: "hi" }).toDict(),
  new AIMessage({ id: "assistant-1", content: "prior" }).toDict(),
];
const listKey = "messages:thread:thread-1";
const metaKey = "messages:meta:thread:thread-1";
const invokerCall = {
  threadId: "thread-1",
  assistantMessageId: "assistant-1",
  state: { tools: [] } as never,
  agentName: "TestAgent",
};

describe("createLangChainAdapter — TTL propagation", () => {
  it("forwards adapter ttlSeconds to a created invoker's writes", async () => {
    const redis = createMockRedis(retriedThread);
    const model = createMockModel();
    const adapter = createLangChainAdapter({
      redis: redis as never,
      ttlSeconds: 3600,
    });

    await adapter.createModelInvoker(model as never)(invokerCall);

    expect(redis.expire).toHaveBeenCalledWith(listKey, 3600);
    expect(redis.expire).not.toHaveBeenCalledWith(listKey, THREAD_TTL_SECONDS);
  });

  it("forwards adapter ttlSeconds to thread-op writes", async () => {
    const redis = createMockRedis([]);
    const adapter = createLangChainAdapter({
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
    const model = createMockModel();
    const adapter = createLangChainAdapter({ redis: redis as never });

    await adapter.createModelInvoker(model as never)(invokerCall);

    expect(redis.expire).toHaveBeenCalledWith(listKey, THREAD_TTL_SECONDS);
  });
});
