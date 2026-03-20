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
  SubagentSandboxConfig,
  SubagentWorkflowInput,
} from "./types";
import type { SubagentArgs } from "./tool";
import type { z } from "zod";
import type { ThreadInit, SandboxInit, SubagentSandboxShutdown } from "../lifecycle";
import { childResultSignal, destroySandboxSignal } from "./signals";

/**
 * Resolve the shorthand/object `SubagentSandboxConfig` into a normalized form.
 */
function resolveSandboxConfig(config?: SubagentSandboxConfig): {
  source: "none" | "inherit" | "own";
  shutdown?: SubagentSandboxShutdown;
} {
  if (!config || config === "none") return { source: "none" };
  if (config === "inherit") return { source: "inherit" };
  if (config === "own") return { source: "own" };
  return { source: "own", shutdown: config.shutdown };
}

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
  const pendingDestroys = new Map<
    string,
    Awaited<ReturnType<typeof startChild>>
  >();
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
    const sandboxCfg = resolveSandboxConfig(config.sandbox);

    if (sandboxCfg.source === "inherit" && !parentSandboxId) {
      throw new Error(
        `Subagent "${config.agentName}" is configured with sandbox: "inherit" but the parent has no sandbox`
      );
    }

    const threadMode = config.thread ?? "new";
    const allowsContinuation = threadMode !== "new";
    const continuationThreadId =
      args.threadId && allowsContinuation ? args.threadId : undefined;

    // --- Build thread init ---
    let thread: ThreadInit | undefined;
    if (continuationThreadId) {
      thread = { mode: threadMode as "fork" | "continue", threadId: continuationThreadId };

    }

    // --- Build sandbox init ---
    let sandbox: SandboxInit | undefined;
    if (sandboxCfg.source === "inherit" && parentSandboxId) {
      sandbox = { mode: "inherit", sandboxId: parentSandboxId };
    } else if (sandboxCfg.source === "own") {
      const prevSbId = continuationThreadId
        ? threadSandboxes.get(continuationThreadId)
        : undefined;
      if (prevSbId) {
        sandbox = { mode: "fork", sandboxId: prevSbId };
      }
      // When no previous sandbox, omit — the child will create its own via sandboxOps
    }

    const workflowInput: SubagentWorkflowInput = {
      ...(thread && { thread }),
      ...(sandbox && { sandbox }),
      ...(sandboxCfg.shutdown && { sandboxShutdown: sandboxCfg.shutdown }),
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

    const usesOwnSandbox =
      sandboxCfg.source === "own" || (allowsContinuation && sandboxCfg.source !== "inherit");

    if (usesOwnSandbox) {
      pendingDestroys.set(childWorkflowId, childHandle);
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
      metadata,
    } = childResult;

    if (allowsContinuation && childSandboxId && childThreadId) {
      threadSandboxes.set(childThreadId, childSandboxId);
    }

    if (!toolResponse) {
      return {
        toolResponse: "Subagent workflow returned no response",
        data: null,
        ...(usage && { usage }),
        ...(childSandboxId && { sandboxId: childSandboxId }),
        ...(metadata && { metadata }),
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
        ...(metadata && { metadata }),
      };
    }

    let finalToolResponse: ToolMessageContent = toolResponse;

    if (allowsContinuation && childThreadId) {
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
      ...(metadata && { metadata }),
    };
  };

  const destroySubagentSandboxes = async (): Promise<void> => {
    const handles = [...pendingDestroys.values()];
    pendingDestroys.clear();
    await Promise.all(
      handles.map(async (handle) => {
        await handle.signal(destroySandboxSignal);
        await handle.result();
      })
    );
  };

  return { handler, destroySubagentSandboxes };
}
