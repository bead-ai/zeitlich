import { describe, expect, it, vi, beforeEach } from "vitest";
import { withCache } from "./with-cache";
import type { RouterContext, ToolHandlerResponse } from "./types";

// ---------------------------------------------------------------------------
// Minimal Redis mock
// ---------------------------------------------------------------------------

function createRedisMock() {
  const store = new Map<string, { value: string; ttl?: number }>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key)?.value ?? null),
    set: vi.fn(
      async (key: string, value: string, _ex?: string, ttl?: number) => {
        store.set(key, { value, ttl });
        return "OK";
      }
    ),
  };
}

type RedisMock = ReturnType<typeof createRedisMock>;

function ctx(overrides?: Partial<RouterContext>): RouterContext {
  return {
    threadId: "wf-1",
    toolCallId: "tc-1",
    toolName: "Lookup",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("withCache", () => {
  let redis: RedisMock;

  beforeEach(() => {
    redis = createRedisMock();
  });

  it("calls the handler on cache miss and caches the response", async () => {
    const handler = vi.fn(
      async (
        args: { query: string },
        _ctx: RouterContext
      ): Promise<ToolHandlerResponse<{ answer: string }>> => ({
        toolResponse: `result for ${args.query}`,
        data: { answer: args.query },
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = withCache(redis as any, handler);

    const result = await wrapped({ query: "hello" }, ctx());

    expect(handler).toHaveBeenCalledOnce();
    expect(result.toolResponse).toBe("result for hello");
    expect(result.data).toEqual({ answer: "hello" });

    expect(redis.set).toHaveBeenCalledOnce();
    const call = redis.set.mock.calls[0] as [string, string, string, number];
    expect(call[0]).toMatch(/^toolcache:wf-1:Lookup:/);
    expect(JSON.parse(call[1])).toEqual({
      toolResponse: "result for hello",
      data: { answer: "hello" },
    });
  });

  it("returns cached response without calling handler on cache hit", async () => {
    const handler = vi.fn(
      async (): Promise<ToolHandlerResponse<{ n: number }>> => ({
        toolResponse: "fresh",
        data: { n: 1 },
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = withCache(redis as any, handler);

    // First call — populates cache
    await wrapped({ x: 1 }, ctx());
    expect(handler).toHaveBeenCalledOnce();

    // Second call — should hit cache
    const cached = await wrapped({ x: 1 }, ctx());
    expect(handler).toHaveBeenCalledOnce(); // still 1
    expect(cached.toolResponse).toBe("fresh");
    expect(cached.data).toEqual({ n: 1 });
  });

  it("does not set resultAppended on cached responses", async () => {
    const handler = vi.fn(
      async (): Promise<ToolHandlerResponse<null>> => ({
        toolResponse: "ok",
        data: null,
        resultAppended: true,
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = withCache(redis as any, handler);

    await wrapped({}, ctx());
    const cached = await wrapped({}, ctx());

    expect(cached.resultAppended).toBeUndefined();
  });

  it("produces different cache keys for different args", async () => {
    const handler = vi.fn(
      async (args: { q: string }): Promise<ToolHandlerResponse<null>> => ({
        toolResponse: args.q,
        data: null,
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = withCache(redis as any, handler);

    await wrapped({ q: "a" }, ctx());
    await wrapped({ q: "b" }, ctx());

    expect(handler).toHaveBeenCalledTimes(2);
    expect(redis.store.size).toBe(2);
  });

  it("produces different cache keys for different threadIds", async () => {
    const handler = vi.fn(
      async (): Promise<ToolHandlerResponse<null>> => ({
        toolResponse: "ok",
        data: null,
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = withCache(redis as any, handler);

    await wrapped({}, ctx({ threadId: "wf-1" }));
    await wrapped({}, ctx({ threadId: "wf-2" }));

    expect(handler).toHaveBeenCalledTimes(2);
    expect(redis.store.size).toBe(2);
  });

  it("produces different cache keys for different tool names", async () => {
    const handler = vi.fn(
      async (): Promise<ToolHandlerResponse<null>> => ({
        toolResponse: "ok",
        data: null,
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = withCache(redis as any, handler);

    await wrapped({}, ctx({ toolName: "ToolA" }));
    await wrapped({}, ctx({ toolName: "ToolB" }));

    expect(handler).toHaveBeenCalledTimes(2);
    expect(redis.store.size).toBe(2);
  });

  it("respects custom TTL", async () => {
    const handler = vi.fn(
      async (): Promise<ToolHandlerResponse<null>> => ({
        toolResponse: "ok",
        data: null,
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = withCache(redis as any, handler, { ttl: 3600 });

    await wrapped({}, ctx());

    const call = redis.set.mock.calls[0] as [string, string, string, number];
    expect(call[3]).toBe(3600);
  });

  it("uses default 90-day TTL when no option is provided", async () => {
    const handler = vi.fn(
      async (): Promise<ToolHandlerResponse<null>> => ({
        toolResponse: "ok",
        data: null,
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = withCache(redis as any, handler);

    await wrapped({}, ctx());

    const call = redis.set.mock.calls[0] as [string, string, string, number];
    expect(call[3]).toBe(60 * 60 * 24 * 90);
  });

  it("propagates handler errors without caching", async () => {
    const handler = vi.fn(async (): Promise<ToolHandlerResponse<null>> => {
      throw new Error("handler exploded");
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = withCache(redis as any, handler);

    await expect(wrapped({}, ctx())).rejects.toThrow("handler exploded");
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.store.size).toBe(0);
  });

  it("passes args and context through to the handler", async () => {
    let capturedArgs: unknown = null;
    let capturedCtx: RouterContext | null = null;

    const handler = async (
      args: { path: string },
      context: RouterContext
    ): Promise<ToolHandlerResponse<null>> => {
      capturedArgs = args;
      capturedCtx = context;
      return { toolResponse: "ok", data: null };
    };

    const context = ctx({
      threadId: "t-42",
      toolCallId: "tc-99",
      toolName: "ReadFile",
      sandboxId: "sb-1",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = withCache(redis as any, handler);
    await wrapped({ path: "/etc/hosts" }, context);

    expect(capturedArgs).toEqual({ path: "/etc/hosts" });
    expect(capturedCtx).toEqual(context);
  });
});
