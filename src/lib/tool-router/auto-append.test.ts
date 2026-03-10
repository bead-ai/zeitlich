import { describe, expect, it, vi } from "vitest";
import { withAutoAppend } from "./auto-append";
import type { RouterContext } from "./types";

describe("withAutoAppend", () => {
  const ctx: RouterContext = {
    threadId: "thread-1",
    toolCallId: "call-1",
    toolName: "TestTool",
  };

  it("appends result to thread and sets resultAppended", async () => {
    const threadHandler = vi.fn().mockResolvedValue(undefined);
    const innerHandler = vi.fn().mockResolvedValue({
      toolResponse: "large response payload",
      data: { summary: "small" },
    });

    const wrapped = withAutoAppend(threadHandler, innerHandler);
    const result = await wrapped({ input: "test" }, ctx);

    expect(threadHandler).toHaveBeenCalledWith({
      threadId: "thread-1",
      toolCallId: "call-1",
      toolName: "TestTool",
      content: "large response payload",
    });
    expect(result.resultAppended).toBe(true);
    expect(result.toolResponse).toBe("Response appended via withAutoAppend");
    expect(result.data).toEqual({ summary: "small" });
  });

  it("passes args and context to inner handler", async () => {
    const threadHandler = vi.fn().mockResolvedValue(undefined);
    const innerHandler = vi.fn().mockResolvedValue({
      toolResponse: "ok",
      data: null,
    });

    const wrapped = withAutoAppend(threadHandler, innerHandler);
    await wrapped({ path: "/file.txt" }, ctx);

    expect(innerHandler).toHaveBeenCalledWith({ path: "/file.txt" }, ctx);
  });

  it("propagates errors from inner handler", async () => {
    const threadHandler = vi.fn().mockResolvedValue(undefined);
    const innerHandler = vi.fn().mockRejectedValue(new Error("boom"));

    const wrapped = withAutoAppend(threadHandler, innerHandler);
    await expect(wrapped({}, ctx)).rejects.toThrow("boom");
  });

  it("propagates errors from thread handler", async () => {
    const threadHandler = vi.fn().mockRejectedValue(new Error("thread error"));
    const innerHandler = vi.fn().mockResolvedValue({
      toolResponse: "ok",
      data: null,
    });

    const wrapped = withAutoAppend(threadHandler, innerHandler);
    await expect(wrapped({}, ctx)).rejects.toThrow("thread error");
  });
});
