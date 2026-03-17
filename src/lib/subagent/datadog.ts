import { proxySinks } from "@temporalio/workflow";
import type { Sinks } from "@temporalio/workflow";
import type { TokenUsage } from "../types";
import type {
  SubagentMetadata,
  SubagentMetadataValue,
  SubagentPlugin,
  SubagentPluginError,
  SubagentPluginEvent,
} from "./plugin";

export interface DatadogSubagentEvent {
  name: string;
  phase: SubagentPluginEvent["phase"];
  status: SubagentPluginEvent["status"];
  timestampMs: number;
  groupId: string;
  workflowId: string;
  runId: string;
  rootWorkflowId: string;
  parentWorkflowId?: string;
  threadId: string;
  toolCallId?: string;
  turn?: number;
  subagent: string;
  sandboxMode: "inherit" | "own";
  continuedThread: boolean;
  taskQueue?: string;
  promptChars: number;
  promptBytes: number;
  childWorkflowId?: string;
  childThreadId?: string;
  durationMs?: number;
  usage?: TokenUsage;
  error?: SubagentPluginError;
  metricTags: Record<string, string>;
  metadata: SubagentMetadata;
}

export interface DatadogSubagentSinks extends Sinks {
  zeitlichDatadog: {
    recordSubagentEvent(event: DatadogSubagentEvent): void;
  };
}

export interface CreateDatadogSubagentPluginOptions {
  getMetricTags?: (
    event: SubagentPluginEvent
  ) => Record<string, SubagentMetadataValue | undefined>;
  getMetadata?: (event: SubagentPluginEvent) => SubagentMetadata | undefined;
}

function filterMetadata(
  metadata: Record<string, SubagentMetadataValue | undefined> | undefined
): SubagentMetadata {
  if (!metadata) {
    return {};
  }

  const entries = Object.entries(metadata).filter(
    (_entry): _entry is [string, SubagentMetadataValue] =>
      _entry[1] !== undefined
  );

  return Object.fromEntries(entries);
}

function stringifyTags(
  tags: Record<string, SubagentMetadataValue | undefined>
): Record<string, string> {
  const filtered = filterMetadata(tags);
  return Object.fromEntries(
    Object.entries(filtered).map(([key, value]) => [key, String(value)])
  );
}

function toDatadogEvent(
  event: SubagentPluginEvent,
  options: CreateDatadogSubagentPluginOptions
): DatadogSubagentEvent {
  const promptChars = event.args.prompt.length;
  const promptBytes = new TextEncoder().encode(event.args.prompt).length;

  const baseTags: Record<string, SubagentMetadataValue | undefined> = {
    phase: event.phase,
    status: event.status,
    subagent: event.subagent,
    sandbox_mode: event.sandboxMode,
    continued_thread: event.continuedThread,
  };

  if (event.status === "failure") {
    baseTags.error_category = event.error.category;
    baseTags.error_name = event.error.name;
    if (event.error.timeoutType) {
      baseTags.timeout_type = event.error.timeoutType;
    }
  }

  const metricTags = stringifyTags({
    ...baseTags,
    ...options.getMetricTags?.(event),
  });

  const metadata = filterMetadata(options.getMetadata?.(event));

  return {
    name: `subagent.${event.phase}.${event.status}`,
    phase: event.phase,
    status: event.status,
    timestampMs: event.timestampMs,
    groupId: event.groupId,
    workflowId: event.workflowId,
    runId: event.runId,
    rootWorkflowId: event.rootWorkflowId,
    ...(event.parentWorkflowId && {
      parentWorkflowId: event.parentWorkflowId,
    }),
    threadId: event.threadId,
    ...(event.toolCallId && { toolCallId: event.toolCallId }),
    ...(event.turn !== undefined && { turn: event.turn }),
    subagent: event.subagent,
    sandboxMode: event.sandboxMode,
    continuedThread: event.continuedThread,
    ...(event.taskQueue && { taskQueue: event.taskQueue }),
    promptChars,
    promptBytes,
    ...("childWorkflowId" in event && { childWorkflowId: event.childWorkflowId }),
    ...("childThreadId" in event &&
      event.childThreadId && { childThreadId: event.childThreadId }),
    ...("durationMs" in event &&
      event.durationMs !== undefined && { durationMs: event.durationMs }),
    ...("usage" in event && event.usage && { usage: event.usage }),
    ...("error" in event && event.error && { error: event.error }),
    metricTags,
    metadata,
  };
}

const datadogSinks = proxySinks<DatadogSubagentSinks>();

export function createDatadogSubagentPlugin(
  options: CreateDatadogSubagentPluginOptions = {}
): SubagentPlugin {
  return {
    onEvent(event): void {
      datadogSinks.zeitlichDatadog.recordSubagentEvent(
        toDatadogEvent(event, options)
      );
    },
  };
}
