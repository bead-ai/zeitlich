import { executeChild, workflowInfo } from "@temporalio/workflow";
import { getShortId } from "../thread/id";
import type { ToolHandlerResponse, RouterContext } from "../tool-router";
import type { ToolMessageContent } from "../types";
import type {
  InferSubagentResult,
  SubagentConfig,
  SubagentWorkflowInput,
} from "./types";
import type { SubagentArgs } from "./tool";
import type { z } from "zod";

/** Minimal interface needed by the subagent handler for child-sandbox tracking */
export interface ChildSandboxTracker {
  getChildSandboxId(childThreadId: string): string | undefined;
  setChildSandboxId(childThreadId: string, sandboxId: string): void;
  deleteChildSandboxId(childThreadId: string): void;
}

/** Mutable ref — populated by runSession before the first tool call */
export interface ChildSandboxTrackerRef {
  current: ChildSandboxTracker | null;
}

/**
 * Creates a Subagent tool handler that spawns child workflows for configured subagents.
 *
 * @param subagents - Array of subagent configurations
 * @returns A tool handler function that can be used with the tool router
 */
export function createSubagentHandler<
  const T extends readonly SubagentConfig[],
>(subagents: [...T], trackerRef?: ChildSandboxTrackerRef) {
  const { taskQueue: parentTaskQueue } = workflowInfo();

  return async (
    args: SubagentArgs,
    context: RouterContext
  ): Promise<ToolHandlerResponse<InferSubagentResult<T[number]> | null>> => {
    const config = subagents.find((s) => s.agentName === args.subagent);

    if (!config) {
      throw new Error(
        `Unknown subagent: ${args.subagent}. Available: ${subagents.map((s) => s.agentName).join(", ")}`
      );
    }

    const childWorkflowId = `${args.subagent}-${getShortId()}`;

    const { sandboxId: parentSandboxId } = context;
    const inheritSandbox = config.sandbox !== "own" && !!parentSandboxId;
    const previousThreadId =
      args.threadId && args.threadId !== null && config.allowThreadContinuation
        ? args.threadId
        : undefined;

    const previousSandboxId =
      config.continueSandbox && previousThreadId
        ? trackerRef?.current?.getChildSandboxId(previousThreadId)
        : undefined;

    const workflowInput: SubagentWorkflowInput = {
      ...(previousThreadId && { previousThreadId }),
      ...(inheritSandbox && { sandboxId: parentSandboxId }),
      ...(previousSandboxId !== undefined && { previousSandboxId }),
    };

    const resolvedContext =
      config.context === undefined
        ? undefined
        : typeof config.context === "function"
          ? config.context()
          : config.context;

    const childOpts = {
      workflowId: childWorkflowId,
      args:
        resolvedContext === undefined
          ? ([args.prompt, workflowInput] as const)
          : ([args.prompt, workflowInput, resolvedContext] as const),
      taskQueue: config.taskQueue ?? parentTaskQueue,
    };

    const {
      toolResponse,
      data,
      usage,
      threadId: childThreadId,
      sandboxId: childSandboxId,
    } = typeof config.workflow === "string"
      ? await executeChild(config.workflow, childOpts)
      : await executeChild(config.workflow, childOpts);

    if (config.continueSandbox && childSandboxId && trackerRef?.current) {
      trackerRef.current.setChildSandboxId(childThreadId, childSandboxId);
      // Remove the old mapping once the continuation has been established so
      // stale entries don't accumulate. Commented out for now: a race between
      // parallel child runs could delete a key another invocation is about to read.
      // trackerRef.current.deleteChildSandboxId(previousThreadId ?? "");
    }

    if (!toolResponse) {
      return {
        toolResponse: "Subagent workflow returned no response",
        data: null,
        ...(usage && { usage }),
      };
    }

    const validated = (
      config.resultSchema ? config.resultSchema.safeParse(data) : null
    ) as z.ZodSafeParseResult<InferSubagentResult<T[number]>> | null;

    if (validated && !validated.success) {
      return {
        toolResponse: `Subagent workflow returned invalid data: ${validated.error.message}`,
        data: null,
        ...(usage && { usage }),
      };
    }

    let finalToolResponse: ToolMessageContent = toolResponse;
    if (config.allowThreadContinuation && childThreadId) {
      finalToolResponse =
        typeof toolResponse === "string"
          ? `${toolResponse}\n\n[${config.agentName} Thread ID: ${childThreadId}]`
          : toolResponse;
    }

    return {
      toolResponse: finalToolResponse,
      data: validated ? validated.data : data,
      ...(usage && { usage }),
    };
  };
}
