import {
  CancelledFailure,
  TimeoutFailure,
  log,
  rootCause,
  workflowInfo,
} from "@temporalio/workflow";
import type { RouterContext } from "../tool-router/types";
import type { TokenUsage } from "../types";
import type { SubagentArgs } from "./tool";
import type { SubagentConfig } from "./types";

export type SubagentMetadataValue = string | number | boolean | null;
export type SubagentMetadata = Record<string, SubagentMetadataValue>;

export interface SubagentPluginError {
  name: string;
  message: string;
  stack?: string;
  category: "timeout" | "cancelled" | "application" | "unknown";
  timeoutType?: string;
}

export interface SubagentPluginEventBase {
  phase: "tool" | "child";
  status: "start" | "success" | "failure";
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
  args: SubagentArgs;
  sandboxMode: "inherit" | "own";
  continuedThread: boolean;
  taskQueue?: string;
}

export interface SubagentToolStartEvent extends SubagentPluginEventBase {
  phase: "tool";
  status: "start";
}

export interface SubagentToolSuccessEvent extends SubagentPluginEventBase {
  phase: "tool";
  status: "success";
  durationMs: number;
  result: unknown;
  usage?: TokenUsage;
}

export interface SubagentToolFailureEvent extends SubagentPluginEventBase {
  phase: "tool";
  status: "failure";
  durationMs?: number;
  error: SubagentPluginError;
}

export interface SubagentChildStartEvent extends SubagentPluginEventBase {
  phase: "child";
  status: "start";
  childWorkflowId: string;
}

export interface SubagentChildSuccessEvent extends SubagentPluginEventBase {
  phase: "child";
  status: "success";
  childWorkflowId: string;
  childThreadId?: string;
  durationMs: number;
  usage?: TokenUsage;
}

export interface SubagentChildFailureEvent extends SubagentPluginEventBase {
  phase: "child";
  status: "failure";
  childWorkflowId: string;
  durationMs?: number;
  error: SubagentPluginError;
}

export type SubagentPluginEvent =
  | SubagentToolStartEvent
  | SubagentToolSuccessEvent
  | SubagentToolFailureEvent
  | SubagentChildStartEvent
  | SubagentChildSuccessEvent
  | SubagentChildFailureEvent;

export interface SubagentPlugin {
  onEvent?: (event: SubagentPluginEvent) => void | Promise<void>;
}

export function getExecutionGroupId(): string {
  const info = workflowInfo();
  return info.root?.workflowId ?? info.workflowId;
}

export function createSubagentEventBase(args: {
  subagentArgs: SubagentArgs;
  context: Pick<RouterContext, "threadId"> & { toolCallId?: string; turn?: number };
  config: Pick<SubagentConfig, "agentName" | "sandbox" | "taskQueue">;
}): Omit<
  SubagentPluginEventBase,
  "phase" | "status" | "timestampMs"
> {
  const info = workflowInfo();

  return {
    groupId: getExecutionGroupId(),
    workflowId: info.workflowId,
    runId: info.runId,
    rootWorkflowId: info.root?.workflowId ?? info.workflowId,
    ...(info.parent?.workflowId && { parentWorkflowId: info.parent.workflowId }),
    threadId: args.context.threadId,
    ...(args.context.toolCallId && { toolCallId: args.context.toolCallId }),
    ...(args.context.turn !== undefined && { turn: args.context.turn }),
    subagent: args.config.agentName,
    args: args.subagentArgs,
    sandboxMode: args.config.sandbox ?? "inherit",
    continuedThread:
      args.subagentArgs.threadId !== undefined &&
      args.subagentArgs.threadId !== null,
    ...(args.config.taskQueue && { taskQueue: args.config.taskQueue }),
  };
}

export async function emitSubagentPluginEvent(
  plugins: readonly SubagentPlugin[] | undefined,
  event: SubagentPluginEvent
): Promise<void> {
  if (!plugins || plugins.length === 0) {
    return;
  }

  for (const plugin of plugins) {
    if (!plugin.onEvent) {
      continue;
    }

    try {
      await plugin.onEvent(event);
    } catch (error) {
      const err =
        error instanceof Error ? error : new Error("Subagent plugin failed");
      log.warn("Subagent plugin event emission failed", {
        pluginName: plugin.onEvent.name || "anonymous",
        phase: event.phase,
        status: event.status,
        subagent: event.subagent,
        message: err.message,
      });
    }
  }
}

export function serializeSubagentPluginError(
  error: unknown
): SubagentPluginError {
  const normalized =
    error instanceof Error ? rootCause(error) : new Error(String(error));

  if (normalized instanceof TimeoutFailure) {
    return {
      name: normalized.name,
      message: normalized.message,
      ...(normalized.stack && { stack: normalized.stack }),
      category: "timeout",
      timeoutType: String(normalized.timeoutType),
    };
  }

  if (normalized instanceof CancelledFailure) {
    return {
      name: normalized.name,
      message: normalized.message,
      ...(normalized.stack && { stack: normalized.stack }),
      category: "cancelled",
    };
  }

  if (normalized instanceof Error) {
    return {
      name: normalized.name,
      message: normalized.message,
      ...(normalized.stack && { stack: normalized.stack }),
      category: "application",
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
    category: "unknown",
  };
}
