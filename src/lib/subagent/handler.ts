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
import type { ThreadOps } from "../session/types";
import type { z } from "zod";

/**
 * Creates a Subagent tool handler that spawns child workflows for configured subagents.
 *
 * @param subagents - Array of subagent configurations
 * @returns A tool handler function that can be used with the tool router
 */
export function createSubagentHandler<
  const T extends readonly SubagentConfig[],
>(subagents: [...T], threadOps?: ThreadOps) {
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

    const restoredSnapshot =
      previousThreadId && threadOps
        ? await threadOps.getSnapshot(previousThreadId)
        : null;

    const workflowInput: SubagentWorkflowInput = {
      ...(previousThreadId && { previousThreadId }),
      ...(inheritSandbox && { sandboxId: parentSandboxId }),
      ...(restoredSnapshot && { sandboxSnapshot: restoredSnapshot }),
    };

    const childOpts = {
      workflowId: childWorkflowId,
      args:
        config.context === undefined
          ? ([args.prompt, workflowInput] as const)
          : ([args.prompt, workflowInput, config.context] as const),
      taskQueue: config.taskQueue ?? parentTaskQueue,
    };

    const {
      toolResponse,
      data,
      usage,
      threadId: childThreadId,
      sandboxSnapshot,
    } = typeof config.workflow === "string"
      ? await executeChild(config.workflow, childOpts)
      : await executeChild(config.workflow, childOpts);

    if (sandboxSnapshot && childThreadId && threadOps) {
      await threadOps.saveSnapshot(childThreadId, sandboxSnapshot);
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
