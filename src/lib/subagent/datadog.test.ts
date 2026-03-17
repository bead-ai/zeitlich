import { describe, expect, it, vi } from "vitest";
import { createDatadogSubagentPlugin } from "./datadog";
import { getExecutionGroupId } from "./plugin";
import type { SubagentPluginEvent } from "./plugin";

const temporalTestDoubles = vi.hoisted(() => ({
  recordSubagentEventMock: vi.fn(),
}));

vi.mock("@temporalio/workflow", () => ({
  workflowInfo: (): {
    workflowId: string;
    runId: string;
    root: { workflowId: string };
    parent: { workflowId: string };
  } => ({
    workflowId: "child-workflow",
    runId: "run-1",
    root: { workflowId: "root-workflow" },
    parent: { workflowId: "parent-workflow" },
  }),
  proxySinks: (): {
    zeitlichDatadog: {
      recordSubagentEvent: typeof temporalTestDoubles.recordSubagentEventMock;
    };
  } => ({
    zeitlichDatadog: {
      recordSubagentEvent: temporalTestDoubles.recordSubagentEventMock,
    },
  }),
  rootCause: (error: Error): Error => error,
  TimeoutFailure: class TimeoutFailure extends Error {
    constructor(
      message: string | undefined,
      _lastHeartbeatDetails: unknown,
      public readonly timeoutType: string
    ) {
      super(message);
      this.name = "TimeoutFailure";
    }
  },
  CancelledFailure: class CancelledFailure extends Error {
    constructor(message = "cancelled") {
      super(message);
      this.name = "CancelledFailure";
    }
  },
  log: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe("createDatadogSubagentPlugin", () => {
  it("maps a workflow event into a Datadog sink event", () => {
    temporalTestDoubles.recordSubagentEventMock.mockClear();

    const plugin = createDatadogSubagentPlugin({
      getMetricTags: () => ({ input_bucket: "small" }),
      getMetadata: () => ({ file_count: 4 }),
    });

    const event: SubagentPluginEvent = {
      phase: "tool",
      status: "success",
      timestampMs: 123,
      groupId: "root-workflow",
      workflowId: "child-workflow",
      runId: "run-1",
      rootWorkflowId: "root-workflow",
      parentWorkflowId: "parent-workflow",
      threadId: "thread-1",
      toolCallId: "tc-1",
      turn: 2,
      subagent: "researcher",
      args: {
        subagent: "researcher",
        description: "summarize",
        prompt: "Analyze these files",
      },
      sandboxMode: "inherit",
      continuedThread: false,
      durationMs: 250,
      result: { ok: true },
    };

    plugin.onEvent?.(event);

    expect(temporalTestDoubles.recordSubagentEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "subagent.tool.success",
        groupId: "root-workflow",
        promptChars: event.args.prompt.length,
        metricTags: expect.objectContaining({
          phase: "tool",
          status: "success",
          input_bucket: "small",
        }),
        metadata: { file_count: 4 },
      })
    );
  });
});

describe("getExecutionGroupId", () => {
  it("uses the root workflow id", () => {
    expect(getExecutionGroupId()).toBe("root-workflow");
  });
});
