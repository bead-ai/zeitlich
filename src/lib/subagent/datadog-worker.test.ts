import { describe, expect, it, vi } from "vitest";
import { createDatadogSubagentSinks } from "./datadog-worker";
import type { DatadogSubagentEvent } from "./datadog";

describe("createDatadogSubagentSinks", () => {
  it("translates sink events into Datadog metrics and logs", async () => {
    const increment = vi.fn();
    const histogram = vi.fn();
    const error = vi.fn();

    const sinks = createDatadogSubagentSinks({
      statsd: { increment, histogram },
      logger: { error },
      logEvents: "failures",
    });

    const event: DatadogSubagentEvent = {
      name: "subagent.child.failure",
      phase: "child",
      status: "failure",
      timestampMs: 123,
      groupId: "root-workflow",
      workflowId: "child-workflow",
      runId: "run-1",
      rootWorkflowId: "root-workflow",
      threadId: "thread-1",
      subagent: "researcher",
      sandboxMode: "inherit",
      continuedThread: false,
      promptChars: 9,
      promptBytes: 9,
      childWorkflowId: "researcher-123",
      durationMs: 250,
      metricTags: {
        phase: "child",
        status: "failure",
        subagent: "researcher",
      },
      metadata: {},
      error: {
        name: "TimeoutFailure",
        message: "timed out",
        category: "timeout",
        timeoutType: "START_TO_CLOSE",
      },
    };

    await sinks.zeitlichDatadog.recordSubagentEvent.fn(
      {
        workflowId: "child-workflow",
        workflowType: "ResearcherWorkflow",
        runId: "run-1",
        root: { workflowId: "root-workflow" },
      } as never,
      event
    );

    expect(increment).toHaveBeenCalledWith(
      "zeitlich.subagent.events",
      1,
      expect.arrayContaining([
        "phase:child",
        "status:failure",
        "subagent:researcher",
        "workflow_type:ResearcherWorkflow",
      ])
    );
    expect(increment).toHaveBeenCalledWith(
      "zeitlich.subagent.failures",
      1,
      expect.any(Array)
    );
    expect(increment).toHaveBeenCalledWith(
      "zeitlich.subagent.timeouts",
      1,
      expect.any(Array)
    );
    expect(histogram).toHaveBeenCalledWith(
      "zeitlich.subagent.child.duration_ms",
      250,
      expect.any(Array)
    );
    expect(error).toHaveBeenCalledWith(
      "Zeitlich subagent failure",
      expect.objectContaining({
        workflowId: "child-workflow",
        workflowType: "ResearcherWorkflow",
      })
    );
  });
});
