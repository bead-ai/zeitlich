import { describe, expect, it, vi } from "vitest";

vi.mock("@temporalio/workflow", () => {
  const noop = (): void => {};
  return {
    proxySinks: (): unknown => new Proxy({}, { get: (): typeof noop => noop }),
  };
});

import { composeHooks, composeFailureHooks } from "./hooks";
import type { PostToolUseFailureHook, ToolMap } from "../tool-router/types";

describe("composeHooks", () => {
  it("calls every hook sequentially in order", async () => {
    const order: string[] = [];
    const composed = composeHooks(
      async () => {
        order.push("first");
      },
      async () => {
        order.push("second");
      }
    );

    await composed();

    expect(order).toEqual(["first", "second"]);
  });

  it("returns the last non-undefined result", async () => {
    const composed = composeHooks<[], string | undefined>(
      async () => "first",
      async () => "second"
    );

    await expect(composed()).resolves.toBe("second");
  });

  it("keeps an earlier result when a later hook returns undefined", async () => {
    const composed = composeHooks<[], string | undefined>(
      async () => "first",
      async () => undefined
    );

    await expect(composed()).resolves.toBe("first");
  });
});

describe("composeFailureHooks", () => {
  const ctx = {
    toolCall: { id: "tc-1", name: "Fail", args: {} },
    error: new Error("boom"),
    threadId: "t-1",
    turn: 1,
  };

  it("preserves an earlier hook's fallbackContent when a later hook returns undefined", async () => {
    const recoveryHook: PostToolUseFailureHook<ToolMap> = async () => ({
      fallbackContent: "recovered gracefully",
    });
    const observeHook = vi.fn(
      async () => undefined
    ) as unknown as PostToolUseFailureHook<ToolMap>;

    const composed = composeFailureHooks(recoveryHook, observeHook);
    const result = await composed(ctx);

    expect(result).toEqual({ fallbackContent: "recovered gracefully" });
    expect(observeHook).toHaveBeenCalledWith(ctx);
  });

  it("preserves an earlier recovery when a later observer hook returns an empty result", async () => {
    // createObservabilityHooks().onPostToolUseFailure returns {} — an empty
    // result must not clobber a recovery regardless of composition order.
    const composed = composeFailureHooks<ToolMap>(
      async () => ({ fallbackContent: "recovered gracefully" }),
      async () => ({})
    );

    await expect(composed(ctx)).resolves.toEqual({
      fallbackContent: "recovered gracefully",
    });
  });

  it("lets a later decisive hook override an earlier result", async () => {
    const composed = composeFailureHooks<ToolMap>(
      async () => ({ fallbackContent: "first" }),
      async () => ({ suppress: true })
    );

    await expect(composed(ctx)).resolves.toEqual({ suppress: true });
  });

  it("returns an empty result when no hook is decisive", async () => {
    const composed = composeFailureHooks<ToolMap>(
      async () => ({}),
      async () => ({})
    );

    await expect(composed(ctx)).resolves.toEqual({});
  });
});
