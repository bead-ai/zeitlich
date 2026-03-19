import {
  startChild,
  workflowInfo,
  setHandler,
  condition,
  getExternalWorkflowHandle,
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
import { childResultSignal, destroySandboxSignal } from "./signals";

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
>(subagents: [...T]): {
  handler: (
    args: SubagentArgs,
    context: RouterContext
  ) => Promise<ToolHandlerResponse<InferSubagentResult<T[number]> | null>>;
  destroySubagentSandboxes: () => Promise<void>;
} {
  const { taskQueue: parentTaskQueue } = workflowInfo();

  const childResults = new Map<string, SubagentHandlerResponse>();
  const pendingDestroys = new Set<string>();
  /** Maps childThreadId → sandboxId for sandbox continuation across invocations */
  const threadSandboxes = new Map<string, string>();

  setHandler(childResultSignal, ({ childWorkflowId, result }) => {
    childResults.set(childWorkflowId, result);
  });

  const handler = async (
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

    if (config.sandbox === "inherit" && !parentSandboxId) {
      throw new Error(
        `Subagent "${config.agentName}" is configured with sandbox: "inherit" but the parent has no sandbox`
      );
    }

    const usesOwnSandbox =
      config.sandbox === "own" || !!config.allowThreadContinuation;
    const inheritSandbox =
      config.sandbox === "inherit" && !!parentSandboxId;

    const continuationThreadId =
      args.threadId && config.allowThreadContinuation
        ? args.threadId
        : undefined;

    const previousSandboxId =
      continuationThreadId && config.allowThreadContinuation
        ? threadSandboxes.get(continuationThreadId)
        : undefined;

    const workflowInput: SubagentWorkflowInput = {
      ...(continuationThreadId && {
        previousThreadId: continuationThreadId,
      }),
      ...(inheritSandbox && { sandboxId: parentSandboxId }),
      ...(previousSandboxId && { previousSandboxId }),
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

    const childHandle = await startChild(config.workflow, childOpts);

    if (usesOwnSandbox) {
      pendingDestroys.add(childWorkflowId);
    }

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

    const {
      toolResponse,
      data,
      usage,
      threadId: childThreadId,
      sandboxId: childSandboxId,
    } = childResult;

    if (config.allowThreadContinuation && childSandboxId && childThreadId) {
      threadSandboxes.set(childThreadId, childSandboxId);
    }

    if (!toolResponse) {
      return {
        toolResponse: "Subagent workflow returned no response",
        data: null,
        ...(usage && { usage }),
        ...(childSandboxId && { sandboxId: childSandboxId }),
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
        ...(childSandboxId && { sandboxId: childSandboxId }),
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
      ...(childSandboxId && { sandboxId: childSandboxId }),
    };
  };

  const destroySubagentSandboxes = async (): Promise<void> => {
    const ids = [...pendingDestroys];
    pendingDestroys.clear();
    await Promise.all(
      ids.map((id) =>
        getExternalWorkflowHandle(id).signal(destroySandboxSignal)
      )
    );
  };

  return { handler, destroySubagentSandboxes };
}
