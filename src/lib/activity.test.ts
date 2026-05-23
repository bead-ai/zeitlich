import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock so `withHeartbeat` sees an activity context and we can observe heartbeat() calls.
const heartbeatSpy = vi.fn();
let mockHasContext = true;

vi.mock("@temporalio/activity", () => ({
  Context: {
    current: (): {
      heartbeat: typeof heartbeatSpy;
      cancellationSignal: AbortSignal | undefined;
    } => {
      if (!mockHasContext) throw new Error("Not in activity context");
      return {
        heartbeat: heartbeatSpy,
        cancellationSignal: undefined,
      };
    },
  },
}));

import { withHeartbeat } from "./activity";

describe("withHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    heartbeatSpy.mockClear();
    mockHasContext = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits heartbeats at the requested cadence while fn is in flight", async () => {
    let resolveFn: (() => void) | undefined;
    const slow = new Promise<void>((res) => {
      resolveFn = res;
    });

    const promise = withHeartbeat(1000, () => slow);

    // 3.5s of "work" → expect 3 heartbeats (one each at 1s, 2s, 3s).
    await vi.advanceTimersByTimeAsync(3500);
    expect(heartbeatSpy).toHaveBeenCalledTimes(3);

    resolveFn?.();
    await promise;
  });

  it("stops heartbeating once fn resolves", async () => {
    let resolveFn: (() => void) | undefined;
    const slow = new Promise<void>((res) => {
      resolveFn = res;
    });
    const promise = withHeartbeat(500, () => slow);

    await vi.advanceTimersByTimeAsync(1200); // ~2 heartbeats
    expect(heartbeatSpy).toHaveBeenCalledTimes(2);

    resolveFn?.();
    await promise;

    await vi.advanceTimersByTimeAsync(5000);
    expect(heartbeatSpy).toHaveBeenCalledTimes(2);
  });

  it("stops heartbeating when fn rejects", async () => {
    let rejectFn: ((err: Error) => void) | undefined;
    const slow = new Promise<void>((_, rej) => {
      rejectFn = rej;
    });
    const promise = withHeartbeat(500, () => slow);

    await vi.advanceTimersByTimeAsync(700);
    expect(heartbeatSpy).toHaveBeenCalledTimes(1);

    rejectFn?.(new Error("boom"));
    await expect(promise).rejects.toThrow("boom");

    await vi.advanceTimersByTimeAsync(5000);
    expect(heartbeatSpy).toHaveBeenCalledTimes(1);
  });

  it("no-ops the heartbeat timer when called outside an activity context", async () => {
    mockHasContext = false;

    const result = await withHeartbeat(100, async () => 42);

    expect(result).toBe(42);
    expect(heartbeatSpy).not.toHaveBeenCalled();
  });

  it("forwards fn's return value", async () => {
    const result = await withHeartbeat(1000, async () => "ok");
    expect(result).toBe("ok");
  });
});
