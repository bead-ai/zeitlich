import type { WorkflowInfo } from "@temporalio/workflow";
import type { DatadogSubagentEvent } from "./datadog";

export interface DatadogStatsDLike {
  increment(metric: string, value?: number, tags?: string[]): void;
  histogram(metric: string, value: number, tags?: string[]): void;
}

export interface DatadogLoggerLike {
  info?: (message: string, context?: Record<string, unknown>) => void;
  error?: (message: string, context?: Record<string, unknown>) => void;
}

export interface CreateDatadogSubagentSinksOptions {
  statsd: DatadogStatsDLike;
  logger?: DatadogLoggerLike;
  metricPrefix?: string;
  logEvents?: "none" | "failures" | "all";
  onEvent?: (args: {
    workflowInfo: WorkflowInfo;
    event: DatadogSubagentEvent;
  }) => void | Promise<void>;
}

function toTags(
  event: DatadogSubagentEvent,
  workflowInfo: WorkflowInfo
): string[] {
  return [
    ...Object.entries(event.metricTags).map(([key, value]) => `${key}:${value}`),
    `workflow_type:${workflowInfo.workflowType}`,
  ];
}

function createLogContext(
  event: DatadogSubagentEvent,
  workflowInfo: WorkflowInfo
): Record<string, unknown> {
  return {
    event,
    workflowId: workflowInfo.workflowId,
    workflowType: workflowInfo.workflowType,
    runId: workflowInfo.runId,
    ...(workflowInfo.root?.workflowId && {
      rootWorkflowId: workflowInfo.root.workflowId,
    }),
  };
}

export function createDatadogSubagentSinks(
  options: CreateDatadogSubagentSinksOptions
): {
  zeitlichDatadog: {
    recordSubagentEvent: {
      callDuringReplay: false;
      fn(
        workflowInfo: WorkflowInfo,
        event: DatadogSubagentEvent
      ): Promise<void>;
    };
  };
} {
  const prefix = options.metricPrefix ?? "zeitlich.subagent";

  return {
    zeitlichDatadog: {
      recordSubagentEvent: {
        callDuringReplay: false,
        async fn(workflowInfo, event): Promise<void> {
          const tags = toTags(event, workflowInfo);

          options.statsd.increment(`${prefix}.events`, 1, tags);
          options.statsd.increment(
            `${prefix}.${event.phase}.${event.status}`,
            1,
            tags
          );

          if (event.durationMs !== undefined) {
            options.statsd.histogram(
              `${prefix}.${event.phase}.duration_ms`,
              event.durationMs,
              tags
            );
          }

          if (event.status === "failure") {
            options.statsd.increment(`${prefix}.failures`, 1, tags);
            if (event.error?.category === "timeout") {
              options.statsd.increment(`${prefix}.timeouts`, 1, tags);
            }
          }

          if (options.logEvents === "all") {
            options.logger?.info?.(
              "Zeitlich subagent event",
              createLogContext(event, workflowInfo)
            );
          } else if (
            options.logEvents !== "none" &&
            event.status === "failure"
          ) {
            options.logger?.error?.(
              "Zeitlich subagent failure",
              createLogContext(event, workflowInfo)
            );
          }

          await options.onEvent?.({ workflowInfo, event });
        },
      },
    },
  };
}
