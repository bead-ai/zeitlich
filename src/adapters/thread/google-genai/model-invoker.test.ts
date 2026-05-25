import { describe, expect, it, vi } from "vitest";
import type { Content, GenerateContentResponse, Part } from "@google/genai";
import { createGoogleGenAIModelInvoker } from "./model-invoker";
import type { StoredContent } from "./thread-manager";
import type { AgentResponse } from "../../../lib/model";

function invoke(parts: Part[]): Promise<AgentResponse<Content>> {
  const chunk: Partial<GenerateContentResponse> = {
    candidates: [{ content: { role: "model", parts } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  };

  const stored: StoredContent[] = [
    {
      id: "msg-1",
      content: { role: "user", parts: [{ text: "classify these files" }] },
    },
  ];

  const redis = {
    exists: vi.fn().mockResolvedValue(1),
    lrange: vi.fn().mockResolvedValue(stored.map((m) => JSON.stringify(m))),
    del: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue("OK"),
    rpush: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    eval: vi.fn().mockResolvedValue(1),
  };

  const client = {
    models: {
      generateContentStream: vi.fn().mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          yield chunk;
        },
      }),
    },
  };

  const invoker = createGoogleGenAIModelInvoker({
    redis: redis as never,
    client: client as never,
    model: "gemini-2.5-flash",
  });

  return invoker({
    threadId: "thread-1",
    assistantMessageId: "assistant-1",
    state: { tools: [] } as never,
    agentName: "TestAgent",
  });
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
