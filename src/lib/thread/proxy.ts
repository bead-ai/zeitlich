/**
 * Shared proxy helper for thread operations.
 *
 * Each adapter re-exports a thin wrapper that supplies its prefix and
 * casts the return type to carry the adapter's native content type.
 */
import {
  proxyActivities,
  workflowInfo,
  type ActivityInterfaceFor,
} from "@temporalio/workflow";
import type { ThreadOps } from "../session/types";

/**
 * Creates a workflow-safe Temporal activity proxy for {@link ThreadOps}.
 *
 * The proxy resolves activity names by combining the adapter prefix with
 * the workflow scope, so each adapter + workflow combination gets its own
 * namespace.
 *
 * @param adapterPrefix - Adapter identifier (e.g. "anthropic", "googleGenAI", "langChain")
 * @param scope - Optional workflow scope override. Defaults to `workflowInfo().workflowType`.
 * @param options - Optional Temporal `proxyActivities` options.
 */
export function createThreadOpsProxy(
  adapterPrefix: string,
  scope?: string,
  options?: Parameters<typeof proxyActivities>[0],
): ActivityInterfaceFor<ThreadOps> {
  const resolvedScope = scope ?? workflowInfo().workflowType;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const acts = proxyActivities<Record<string, (...args: any[]) => any>>(
    options ?? {
      startToCloseTimeout: "10s",
      retry: {
        maximumAttempts: 6,
        initialInterval: "5s",
        maximumInterval: "15m",
        backoffCoefficient: 4,
      },
    },
  );

  const prefix =
    `${adapterPrefix}${resolvedScope.charAt(0).toUpperCase()}${resolvedScope.slice(1)}`;
  const p = (key: string): string =>
    `${prefix}${key.charAt(0).toUpperCase()}${key.slice(1)}`;

  return {
    initializeThread: acts[p("initializeThread")],
    appendHumanMessage: acts[p("appendHumanMessage")],
    appendToolResult: acts[p("appendToolResult")],
    appendAgentMessage: acts[p("appendAgentMessage")],
    appendSystemMessage: acts[p("appendSystemMessage")],
    forkThread: acts[p("forkThread")],
    truncateThread: acts[p("truncateThread")],
  } as ActivityInterfaceFor<ThreadOps>;
}
