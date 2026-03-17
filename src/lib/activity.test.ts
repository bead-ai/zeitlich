import { beforeEach, describe, expect, it, vi } from "vitest";
import type Redis from "ioredis";
import type { RouterContext, ToolHandlerResponse } from "./tool-router/types";
import { withToolCallCache } from "./activity";

let currentWorkflowId = "workflow-1";

vi.mock("@temporalio/activity", () => ({
  Context: {
    current: (): {
      info: {
        workflowExecution: {
          workflowId: string;
          runId: string;
        };
      };
    } => ({
      info: {
        workflowExecution: {
          workflowId: currentWorkflowId,
          runId: "run-1",
        },
      },
    }),
  },
}));

function createContext(
  overrides: Partial<RouterContext> = {}
): RouterContext {
  return {
    threadId: "thread-1",
    toolCallId: "tool-call-1",
    toolName: "Echo",
    ...overrides,
  };
}

function createRedisMock(
  overrides: Partial<Pick<Redis, "get" | "set">> = {}
): Pick<Redis, "get" | "set"> & {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, string>();

  const redis = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(
      async (key: string, value: string) => {
        store.set(key, value);
        return "OK";
      }
    ),
  };

  return {
    ...redis,
    ...overrides,
  } as Pick<Redis, "get" | "set"> & {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };
}

describe("withToolCallCache", () => {
  beforeEach(() => {
    currentWorkflowId = "workflow-1";
  });

  it("reuses cached responses for the same workflow and stable tool input", async () => {
    const redis = createRedisMock();
    const handler = vi.fn(
      async (
        args: { left: number; right: number }
      ): Promise<ToolHandlerResponse<{ sum: number }>> => ({
        toolResponse: `Sum: ${args.left + args.right}`,
        data: { sum: args.left + args.right },
      })
    );

    const wrapped = withToolCallCache(redis, handler);

    const first = await wrapped(
      { right: 2, left: 1 },
      createContext({ toolName: "Add", toolCallId: "tool-call-1" })
    );
    const second = await wrapped(
      { left: 1, right: 2 },
      createContext({ toolName: "Add", toolCallId: "tool-call-2" })
    );

    expect(first).toEqual(second);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(redis.get).toHaveBeenCalledTimes(2);
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining("tool-call-cache:workflow-1:Add:"),
      JSON.stringify(first),
      "EX",
      60 * 60 * 24
    );
  });

  it("scopes cache entries by workflow id", async () => {
    const redis = createRedisMock();
    const handler = vi.fn(
      async (): Promise<ToolHandlerResponse<{ echoed: string }>> => ({
        toolResponse: "Echo: hello",
        data: { echoed: "hello" },
      })
    );

    const wrapped = withToolCallCache(redis, handler);

    await wrapped(
      { text: "hello" },
      createContext({ toolName: "Echo", toolCallId: "tool-call-1" })
    );

    currentWorkflowId = "workflow-2";

    await wrapped(
      { text: "hello" },
      createContext({ toolName: "Echo", toolCallId: "tool-call-2" })
    );

    expect(handler).toHaveBeenCalledTimes(2);
    expect(redis.set).toHaveBeenCalledTimes(2);
  });

  it("does not cache handlers that already append their own result", async () => {
    const redis = createRedisMock();
    const handler = vi.fn(
      async (): Promise<ToolHandlerResponse<{ ok: boolean }>> => ({
        toolResponse: "already appended",
        data: { ok: true },
        resultAppended: true,
      })
    );

    const wrapped = withToolCallCache(redis, handler);

    await wrapped(
      { path: "/tmp/demo.txt" },
      createContext({ toolName: "ReadFile", toolCallId: "tool-call-1" })
    );
    await wrapped(
      { path: "/tmp/demo.txt" },
      createContext({ toolName: "ReadFile", toolCallId: "tool-call-2" })
    );

    expect(handler).toHaveBeenCalledTimes(2);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("fails open when Redis reads or writes fail", async () => {
    const redis = createRedisMock({
      get: vi.fn(async () => {
        throw new Error("redis unavailable");
      }),
      set: vi.fn(async () => {
        throw new Error("redis unavailable");
      }),
    });
    const handler = vi.fn(
      async (): Promise<ToolHandlerResponse<{ echoed: string }>> => ({
        toolResponse: "Echo: fallback",
        data: { echoed: "fallback" },
      })
    );

    const wrapped = withToolCallCache(redis, handler);

    await expect(
      wrapped(
        { text: "fallback" },
        createContext({ toolName: "Echo", toolCallId: "tool-call-1" })
      )
    ).resolves.toEqual({
      toolResponse: "Echo: fallback",
      data: { echoed: "fallback" },
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(redis.get).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledTimes(1);
  });
});
