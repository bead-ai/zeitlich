import {
  workflowInfo,
  setHandler,
  condition,
  log,
  ApplicationFailure,
  executeChild,
} from "@temporalio/workflow";
import { getShortId } from "../thread/id";
import type { ToolHandlerResponse, RouterContext } from "../tool-router";
import type { JsonValue } from "../state/types";
import type {
  InferSubagentResult,
  SubagentConfig,
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
import type { SandboxOps, SandboxSnapshot } from "../sandbox/types";
import { childSandboxReadySignal } from "./signals";

/** Normalized sandbox config after resolving the union. */
interface ResolvedSandboxConfig {
  source: "none" | "inherit" | "own";
  init: "per-call" | "once";
  continuation: "continue" | "fork" | "snapshot";
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
 * Sandbox and snapshot cleanup happens inside the parent via each subagent's
 * `sandbox.proxy` — the proxy factory is invoked once per subagent with
 * `scope = agentName` so it resolves to the same activities the child uses.
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
  cleanupSubagentSnapshots: () => Promise<void>;
} {
  const { taskQueue: parentTaskQueue } = workflowInfo();

  /** Sandbox ops proxy per subagent, built eagerly from `sandbox.proxy` factories. */
  const agentSandboxOps = new Map<string, SandboxOps>();
  for (const cfg of subagents) {
    if (cfg.sandbox && cfg.sandbox !== "none") {
      agentSandboxOps.set(cfg.agentName, cfg.sandbox.proxy(cfg.agentName));
    }
  }

  /**
   * Sandboxes that outlived their child session and must be destroyed by the
   * parent at shutdown (shutdown = `pause-until-parent-close` /
   * `keep-until-parent-close`). Keyed by `persistent:<agent>` for lazy
   * shared sandboxes and by childWorkflowId otherwise.
   */
  const pendingDestroys = new Map<
    string,
    { agentName: string; sandboxId: string }
  >();
  /** Maps childThreadId → sandboxId for sandbox continuation across invocations (init: per-call) */
  const threadSandboxes = new Map<string, string>();
  /** Maps agentName → sandboxId for persistent sandboxes (init: once) */
  const persistentSandboxes = new Map<string, string>();
  /** Tracks agents whose first lazy sandbox creation is in-flight (guards concurrent init) */
  const persistentSandboxCreating = new Set<string>();
  /** Reverse lookup: childWorkflowId → agentName for in-flight lazy creators */
  const lazyCreatorAgent = new Map<string, string>();
  /** Maps childThreadId → latest snapshot for sandbox continuation via snapshots */
  const threadSnapshots = new Map<
    string,
    {
      agentName: string;
      snapshot: SandboxSnapshot;
    }
  >();
  /** Maps agentName → reusable base snapshot captured on first-ever call (init: once + continuation: "snapshot") */
  const persistentBaseSnapshot = new Map<string, SandboxSnapshot>();
  /** Tracks agents whose first snapshot-backed sandbox creation is in-flight */
  const persistentBaseSnapshotCreating = new Set<string>();

  setHandler(childSandboxReadySignal, ({ childWorkflowId, sandboxId }) => {
    const agentName = lazyCreatorAgent.get(childWorkflowId);
    if (agentName && !persistentSandboxes.has(agentName)) {
      persistentSandboxes.set(agentName, sandboxId);
      lazyCreatorAgent.delete(childWorkflowId);
    }
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

    if (
      sandboxCfg.source !== "none" &&
      !agentSandboxOps.has(config.agentName)
    ) {
      throw ApplicationFailure.create({
        message: `Subagent "${config.agentName}" uses a sandbox but no \`sandbox.proxy\` is configured on its SubagentConfig`,
        nonRetryable: true,
      });
    }

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
    let isSnapshotBaseCreator = false;

    if (sandboxCfg.source === "inherit" && parentSandboxId) {
      if (sandboxCfg.continuation === "fork") {
        sandbox = { mode: "fork", sandboxId: parentSandboxId };
      } else if (sandboxCfg.continuation === "snapshot") {
        throw new Error(
          `Subagent "${config.agentName}" has sandbox source "inherit" with continuation "snapshot" — snapshot continuation is only supported for source "own"`
        );
      } else {
        sandbox = { mode: "inherit", sandboxId: parentSandboxId };
      }
    } else if (
      sandboxCfg.source === "own" &&
      sandboxCfg.continuation === "snapshot"
    ) {
      // Snapshot-driven continuation: each call boots a fresh sandbox from a
      // stored snapshot (per-thread, or a per-agent base for new threads with
      // init: "once"). The session destroys its sandbox inline on exit;
      // stored snapshot IDs are cleaned up by the parent at shutdown.
      const isLazy = sandboxCfg.init === "once";

      let baseSnap: SandboxSnapshot | undefined;
      if (continuationThreadId) {
        baseSnap = threadSnapshots.get(continuationThreadId)?.snapshot;
      }

      if (!baseSnap && isLazy) {
        baseSnap = persistentBaseSnapshot.get(config.agentName);
        if (!baseSnap) {
          if (persistentBaseSnapshotCreating.has(config.agentName)) {
            await condition(() => persistentBaseSnapshot.has(config.agentName));
            baseSnap = persistentBaseSnapshot.get(config.agentName);
          } else {
            persistentBaseSnapshotCreating.add(config.agentName);
            isSnapshotBaseCreator = true;
          }
        }
      }

      if (baseSnap) {
        sandbox = { mode: "from-snapshot", snapshot: baseSnap };
      }
      sandboxShutdownOverride = "snapshot";
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

    if (isLazyCreator) {
      lazyCreatorAgent.set(childWorkflowId, config.agentName);
    }

    log.info("subagent spawned", {
      subagent: config.agentName,
      childWorkflowId,
      threadMode,
      sandboxSource: sandboxCfg.source,
    });

    const childResult = await executeChild(config.workflow, childOpts);

    const effectiveShutdown =
      sandboxShutdownOverride ?? sandboxCfg.shutdown ?? "destroy";

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
      snapshot: childSnapshot,
      baseSnapshot: childBaseSnapshot,
      metadata,
    } = childResult;

    if (childSandboxId) {
      if (
        sandboxCfg.source === "own" &&
        sandboxCfg.init === "once" &&
        sandboxCfg.continuation !== "snapshot" &&
        !persistentSandboxes.has(config.agentName)
      ) {
        // Fallback: signal may have already set this via childSandboxReadySignal
        persistentSandboxes.set(config.agentName, childSandboxId);
      } else if (
        allowsContinuation &&
        childThreadId &&
        sandboxCfg.source === "own" &&
        sandboxCfg.continuation !== "snapshot"
      ) {
        threadSandboxes.set(childThreadId, childSandboxId);
      }
    }

    // Track sandboxes that must be destroyed by the parent at shutdown.
    if (
      childSandboxId &&
      (effectiveShutdown === "pause-until-parent-close" ||
        effectiveShutdown === "keep-until-parent-close")
    ) {
      const key = isLazyCreator
        ? `persistent:${config.agentName}`
        : childWorkflowId;
      pendingDestroys.set(key, {
        agentName: config.agentName,
        sandboxId: childSandboxId,
      });
    }

    // Store snapshots for future snapshot-driven continuation and final sweep.
    // Tag each with `agentName` so `cleanupSubagentSnapshots` knows which
    // sandbox ops to call for deletion.
    if (sandboxCfg.source === "own" && sandboxCfg.continuation === "snapshot") {
      if (childSnapshot && childThreadId) {
        threadSnapshots.set(childThreadId, {
          agentName: config.agentName,
          snapshot: childSnapshot,
        });
      }
      if (
        isSnapshotBaseCreator &&
        childBaseSnapshot &&
        !persistentBaseSnapshot.has(config.agentName)
      ) {
        persistentBaseSnapshot.set(config.agentName, childBaseSnapshot);
      }
    }

    if (isLazyCreator) {
      persistentSandboxCreating.delete(config.agentName);
      lazyCreatorAgent.delete(childWorkflowId);
    }
    if (isSnapshotBaseCreator) {
      persistentBaseSnapshotCreating.delete(config.agentName);
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
      data: validated
        ? validated.data
        : (data as InferSubagentResult<T[number]> | null),
      ...(usage && { usage }),
      ...(childSandboxId && { sandboxId: childSandboxId }),
      ...(metadata && { metadata }),
    };
  };

  const destroySubagentSandboxes = async (): Promise<void> => {
    const entries = [...pendingDestroys.values()];
    pendingDestroys.clear();
    await Promise.all(
      entries.map(async ({ agentName, sandboxId }) => {
        const ops = agentSandboxOps.get(agentName);
        if (!ops) {
          log.warn(
            "Skipping sandbox destroy — no sandbox.proxy registered for agent",
            { agentName, sandboxId }
          );
          return;
        }
        try {
          await ops.destroySandbox(sandboxId);
        } catch (err) {
          log.warn("Failed to destroy subagent sandbox", {
            agentName,
            sandboxId,
            error: err,
          });
        }
      })
    );
  };

  const cleanupSubagentSnapshots = async (): Promise<void> => {
    const tagged = [];
    for (const entry of threadSnapshots.values()) tagged.push(entry);
    for (const [agentName, snapshot] of persistentBaseSnapshot.entries()) {
      tagged.push({ agentName, snapshot });
    }
    threadSnapshots.clear();
    persistentBaseSnapshot.clear();

    await Promise.all(
      tagged.map(async ({ agentName, snapshot }) => {
        const ops = agentSandboxOps.get(agentName);
        if (!ops) {
          log.warn(
            "Skipping snapshot delete — no sandbox.proxy registered for agent",
            { agentName }
          );
          return;
        }
        try {
          await ops.deleteSandboxSnapshot(snapshot);
        } catch (err) {
          log.warn("Failed to delete subagent snapshot", {
            agentName,
            error: err,
          });
        }
      })
    );
  };

  return { handler, destroySubagentSandboxes, cleanupSubagentSnapshots };
}
