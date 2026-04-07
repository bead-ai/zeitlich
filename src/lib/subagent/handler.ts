import {
  startChild,
  workflowInfo,
  setHandler,
  condition,
  log,
} from "@temporalio/workflow";
import { getShortId } from "../thread/id";
import type { ToolHandlerResponse, RouterContext } from "../tool-router";
import type { JsonValue } from "../state/types";
import type {
  InferSubagentResult,
  SubagentConfig,
  SubagentHandlerResponse,
  SubagentSandboxConfig,
  SubagentWorkflowInput,
} from "./types";
import type { SubagentArgs } from "./tool";
import type { z } from "zod";
import type {
  ThreadInit,
  SandboxInit,
  SubagentSandboxShutdown,
} from "../lifecycle";
import { childResultSignal, destroySandboxSignal } from "./signals";

/** Normalized sandbox config after resolving the union. */
interface ResolvedSandboxConfig {
  source: "none" | "inherit" | "own";
  init: "per-call" | "once";
  continuation: "continue" | "fork";
  shutdown?: SubagentSandboxShutdown;
}

function resolveSandboxConfig(
  config?: SubagentSandboxConfig
): ResolvedSandboxConfig {
  if (!config || config === "none") {
    return { source: "none", init: "per-call", continuation: "fork" };
  }
  if (config.source === "inherit") {
    return {
      source: "inherit",
      init: "per-call",
      continuation: config.continuation,
      shutdown: config.shutdown,
    };
  }
  return {
    source: "own",
    init: config.init ?? "per-call",
    continuation: config.continuation,
    shutdown: config.shutdown,
  };
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
>(
  subagents: [...T]
): {
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
  /** Maps childThreadId → sandboxId for sandbox continuation across invocations (init: per-call) */
  const threadSandboxes = new Map<string, string>();
  /** Maps agentName → sandboxId for persistent sandboxes (init: once) */
  const persistentSandboxes = new Map<string, string>();
  /** Tracks agents whose first lazy sandbox creation is in-flight (guards concurrent init) */
  const persistentSandboxCreating = new Set<string>();

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
      thread = {
        mode: threadMode as "fork" | "continue",
        threadId: continuationThreadId,
      };
    }

    // --- Build sandbox init ---
    let sandbox: SandboxInit | undefined;
    let sandboxShutdownOverride: SubagentSandboxShutdown | undefined;
    let isLazyCreator = false;

    if (sandboxCfg.source === "inherit" && parentSandboxId) {
      if (sandboxCfg.continuation === "fork") {
        sandbox = { mode: "fork", sandboxId: parentSandboxId };
      } else {
        sandbox = { mode: "inherit", sandboxId: parentSandboxId };
      }
    } else if (sandboxCfg.source === "own") {
      const isLazy = sandboxCfg.init === "once";

      let baseSandboxId: string | undefined;
      if (isLazy) {
        baseSandboxId = persistentSandboxes.get(config.agentName);
        if (!baseSandboxId) {
          if (persistentSandboxCreating.has(config.agentName)) {
            // Another call is already creating — wait for it to finish
            await condition(() => persistentSandboxes.has(config.agentName));
            baseSandboxId = persistentSandboxes.get(config.agentName);
          } else {
            // We're the first concurrent caller — claim the creator role
            persistentSandboxCreating.add(config.agentName);
            isLazyCreator = true;
          }
        }
      } else if (continuationThreadId) {
        baseSandboxId = threadSandboxes.get(continuationThreadId);
      }

      if (baseSandboxId) {
        sandbox = {
          mode: sandboxCfg.continuation === "continue" ? "continue" : "fork",
          sandboxId: baseSandboxId,
        };
      }

      // Ensure the sandbox survives for future continuation/fork:
      // - first lazy call (creator): pause-until-parent-close so parent can clean up
      // - continuation=continue: sandbox must survive for next call
      // - lazy+fork (non-creator): template must survive for future forks
      //
      // Skip the override when the user already configured a *-until-parent-close
      // shutdown — that already guarantees survival.
      const userShutdown = sandboxCfg.shutdown;
      const alreadySurvives =
        userShutdown === "pause-until-parent-close" ||
        userShutdown === "keep-until-parent-close" ||
        userShutdown === "pause" ||
        userShutdown === "keep";

      const mustSurvive =
        isLazyCreator ||
        sandboxCfg.continuation === "continue" ||
        (isLazy && sandboxCfg.continuation === "fork");

      if (mustSurvive && !alreadySurvives) {
        sandboxShutdownOverride = isLazyCreator
          ? "pause-until-parent-close"
          : "pause";
      }
    }

    const workflowInput: SubagentWorkflowInput = {
      ...(thread && { thread }),
      ...(sandbox && { sandbox }),
      sandboxShutdown:
        sandboxShutdownOverride ?? sandboxCfg.shutdown ?? undefined,
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

    log.info("subagent spawned", {
      subagent: config.agentName,
      childWorkflowId,
      threadMode,
      sandboxSource: sandboxCfg.source,
    });

    const childHandle = await startChild(config.workflow, childOpts);

    // Track child handles that need signaling at parent shutdown.
    const effectiveShutdown =
      sandboxShutdownOverride ?? sandboxCfg.shutdown ?? "destroy";

    if (
      effectiveShutdown === "pause-until-parent-close" ||
      effectiveShutdown === "keep-until-parent-close"
    ) {
      const key = isLazyCreator
        ? `persistent:${config.agentName}`
        : childWorkflowId;
      pendingDestroys.set(key, childHandle);
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
      log.warn("subagent returned no result", {
        subagent: config.agentName,
        childWorkflowId,
      });
      return {
        toolResponse: "Subagent workflow did not signal a result",
        data: null,
      };
    }

    log.info("subagent completed", {
      subagent: config.agentName,
      childWorkflowId,
      ...(childResult.usage && { usage: childResult.usage }),
    });

    const {
      toolResponse,
      data,
      usage,
      threadId: childThreadId,
      sandboxId: childSandboxId,
      metadata,
    } = childResult;

    // Store sandbox ID for future continuation/fork
    if (childSandboxId) {
      if (
        sandboxCfg.source === "own" &&
        sandboxCfg.init === "once" &&
        !persistentSandboxes.has(config.agentName)
      ) {
        persistentSandboxes.set(config.agentName, childSandboxId);
      } else if (allowsContinuation && childThreadId) {
        threadSandboxes.set(childThreadId, childSandboxId);
      }
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

    let finalToolResponse: JsonValue = toolResponse;

    if (allowsContinuation && childThreadId) {
      const responseStr =
        typeof toolResponse === "string"
          ? toolResponse
          : JSON.stringify(toolResponse);
      finalToolResponse = `${responseStr}\n\n[${config.agentName} Thread ID: ${childThreadId}]`;
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
        try {
          await handle.signal(destroySandboxSignal);
          await handle.result();
        } catch (err) {
          log.warn("Failed to signal destroySandbox to child workflow", {
            error: err,
          });
        }
      })
    );
  };

  return { handler, destroySubagentSandboxes };
}
