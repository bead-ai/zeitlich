import { describe, expect, it } from "vitest";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { appendCachePoint } from "./hooks";

const cacheBlock = {
  type: "cache_control" as const,
  cache_control: { type: "ephemeral" as const },
};

function applyHook(
  messages: BaseMessage[],
  hook: ReturnType<typeof appendCachePoint>
): BaseMessage[] {
  return messages.map((m, i, arr) => hook(m, i, arr));
}

function countCacheBlocks(messages: BaseMessage[]): number {
  return messages.reduce((n, m) => {
    const c = m.content;
    if (Array.isArray(c)) {
      return n + (c.some((b) => b.type === cacheBlock.type) ? 1 : 0);
    }
    return n;
  }, 0);
}

function messageAt(messages: BaseMessage[], idx: number): BaseMessage {
  const m = messages[idx];
  if (!m) throw new Error(`No message at index ${String(idx)}`);
  return m;
}

describe("appendCachePoint", () => {
  it("appends a cache block to the last message", () => {
    const messages: BaseMessage[] = [
      new HumanMessage("hello"),
      new AIMessage("hi"),
      new HumanMessage("bye"),
    ];
    const hook = appendCachePoint(cacheBlock);
    const result = applyHook(messages, hook);

    const last = messageAt(result, 2);
    expect(Array.isArray(last.content)).toBe(true);
    const blocks = last.content as Array<{ type: string }>;
    expect(blocks.some((b) => b.type === cacheBlock.type)).toBe(true);
  });

  it("deduplicates within the last message", () => {
    const messages: BaseMessage[] = [
      new HumanMessage({
        content: [{ type: "text", text: "hello" }, cacheBlock],
      }),
    ];
    const hook = appendCachePoint(cacheBlock);
    const result = applyHook(messages, hook);

    const blocks = (
      messageAt(result, 0).content as Array<{ type: string }>
    ).filter((b) => b.type === cacheBlock.type);
    expect(blocks).toHaveLength(1);
  });

  it("strips old cache blocks when total would exceed maxBlocks", () => {
    const messages: BaseMessage[] = Array.from(
      { length: 6 },
      (_, i) =>
        new HumanMessage({
          content: [{ type: "text", text: `msg ${i}` }, cacheBlock],
        })
    );
    const hook = appendCachePoint(cacheBlock, { maxBlocks: 4 });
    const result = applyHook(messages, hook);

    expect(countCacheBlocks(result)).toBe(4);
  });

  it("keeps the most recent cache blocks", () => {
    const messages: BaseMessage[] = Array.from(
      { length: 6 },
      (_, i) =>
        new HumanMessage({
          content: [{ type: "text", text: `msg ${i}` }, cacheBlock],
        })
    );
    const hook = appendCachePoint(cacheBlock, { maxBlocks: 4 });
    const result = applyHook(messages, hook);

    const hasCache = result.map((m) => {
      const c = m.content;
      return Array.isArray(c) && c.some((b) => b.type === cacheBlock.type);
    });
    expect(hasCache[0]).toBe(false);
    expect(hasCache[1]).toBe(false);
    expect(hasCache[3]).toBe(true);
    expect(hasCache[4]).toBe(true);
    expect(hasCache[5]).toBe(true);
  });

  it("respects a custom maxBlocks value", () => {
    const messages: BaseMessage[] = Array.from(
      { length: 5 },
      (_, i) =>
        new HumanMessage({
          content: [{ type: "text", text: `msg ${i}` }, cacheBlock],
        })
    );
    const hook = appendCachePoint(cacheBlock, { maxBlocks: 2 });
    const result = applyHook(messages, hook);

    expect(countCacheBlocks(result)).toBe(2);
  });

  it("does nothing to non-last messages without cache blocks", () => {
    const messages: BaseMessage[] = [
      new HumanMessage("plain"),
      new AIMessage("response"),
      new HumanMessage("last"),
    ];
    const hook = appendCachePoint(cacheBlock);
    const result = applyHook(messages, hook);

    expect(messageAt(result, 0).content).toBe("plain");
    expect(messageAt(result, 1).content).toBe("response");
    expect(countCacheBlocks(result)).toBe(1);
  });

  it("handles string content on the last message", () => {
    const messages: BaseMessage[] = [new HumanMessage("only")];
    const hook = appendCachePoint(cacheBlock);
    const result = applyHook(messages, hook);

    const first = messageAt(result, 0);
    expect(Array.isArray(first.content)).toBe(true);
    const content = first.content as Array<{ type: string }>;
    expect(content.some((b) => b.type === cacheBlock.type)).toBe(true);
  });

  it("defaults maxBlocks to 4", () => {
    const messages: BaseMessage[] = Array.from(
      { length: 8 },
      (_, i) =>
        new HumanMessage({
          content: [{ type: "text", text: `msg ${i}` }, cacheBlock],
        })
    );
    const hook = appendCachePoint(cacheBlock);
    const result = applyHook(messages, hook);

    expect(countCacheBlocks(result)).toBe(4);
  });

  it("preserves non-cache content blocks when stripping", () => {
    const messages: BaseMessage[] = [
      new HumanMessage({
        content: [
          { type: "text", text: "keep me" },
          cacheBlock,
          { type: "image_url", image_url: { url: "http://example.com" } },
        ],
      }),
      new HumanMessage({
        content: [{ type: "text", text: "msg 1" }, cacheBlock],
      }),
      new HumanMessage({
        content: [{ type: "text", text: "msg 2" }, cacheBlock],
      }),
      new HumanMessage({
        content: [{ type: "text", text: "msg 3" }, cacheBlock],
      }),
      new HumanMessage("last"),
    ];
    const hook = appendCachePoint(cacheBlock, { maxBlocks: 4 });
    const result = applyHook(messages, hook);

    const first = messageAt(result, 0).content as Array<{ type: string }>;
    expect(first.some((b) => b.type === "text")).toBe(true);
    expect(first.some((b) => b.type === "image_url")).toBe(true);
    expect(first.some((b) => b.type === cacheBlock.type)).toBe(false);
  });
});
