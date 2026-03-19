import {
  startChild,
  workflowInfo,
  setHandler,
  condition,
} from "@temporalio/workflow";
import { getShortId } from "../thread/id";
import type { ToolHandlerResponse, RouterContext } from "../tool-router";
import type { ToolMessageContent } from "../types";
import type {
  InferSubagentResult,
  SubagentConfig,
  SubagentHandlerResponse,
  SubagentWorkflowInput,
} from "./types";
import type { SubagentArgs } from "./tool";
import type { z } from "zod";
import { childResultSignal } from "./signals";

/**
 * Creates a Subagent tool handler that spawns child workflows for configured subagents.
 *
 * Child workflows signal their result back via `childResultSignal` instead of
 * returning it as the workflow return value. The handler awaits the signal
 * before continuing.
 *
 * @param subagents - Array of subagent configurations
 * @returns A tool handler function that can be used with the tool router
 */
export function createSubagentHandler<
  const T extends readonly SubagentConfig[],
>(subagents: [...T]) {
  const { taskQueue: parentTaskQueue } = workflowInfo();

  const childResults = new Map<string, SubagentHandlerResponse>();

  setHandler(childResultSignal, ({ childWorkflowId, result }) => {
    childResults.set(childWorkflowId, result);
  });

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

    const workflowInput: SubagentWorkflowInput = {
      ...(args.threadId &&
        args.threadId !== null &&
        config.allowThreadContinuation && {
          previousThreadId: args.threadId,
        }),
      ...(inheritSandbox && { sandboxId: parentSandboxId }),
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

    const childHandle =
      typeof config.workflow === "string"
        ? await startChild(config.workflow, childOpts)
        : await startChild(config.workflow, childOpts);

    // Wait for signal from child; race with child completion to propagate failures
    await Promise.race([
      condition(() => childResults.has(childWorkflowId)),
      childHandle.result(),
    ]);
    if (!childResults.has(childWorkflowId)) {
      await condition(() => childResults.has(childWorkflowId));
    }

    const childResult = childResults.get(childWorkflowId);
    childResults.delete(childWorkflowId);

    if (!childResult) {
      return {
        toolResponse: "Subagent workflow did not signal a result",
        data: null,
      };
    }

    const { toolResponse, data, usage, threadId: childThreadId } = childResult;

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
