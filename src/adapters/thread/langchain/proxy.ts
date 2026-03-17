/**
 * Workflow-safe proxy for LangChain thread operations.
 *
 * Import this from `zeitlich/adapters/thread/langchain/workflow`
 * in your Temporal workflow files.
 *
 * By default the scope is derived from `workflowInfo().workflowType`,
 * so activities are automatically namespaced per workflow.
 *
 * @example
 * ```typescript
 * import { proxyLangChainThreadOps } from 'zeitlich/adapters/thread/langchain/workflow';
 *
 * // Auto-scoped to the current workflow name
 * const threadOps = proxyLangChainThreadOps();
 *
 * // Explicit scope override
 * const threadOps = proxyLangChainThreadOps("customScope");
 * ```
 */
import {
  proxyActivities,
  workflowInfo,
  type ActivityInterfaceFor,
} from "@temporalio/workflow";
import type { ThreadOps } from "../../../lib/session/types";

const ADAPTER_PREFIX = "langChain";

export function proxyLangChainThreadOps(
  scope?: string,
  options?: Parameters<typeof proxyActivities>[0]
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
    }
  );

  const prefix =
    `${resolvedScope}${ADAPTER_PREFIX.charAt(0).toUpperCase()}${ADAPTER_PREFIX.slice(1)}`;
  const p = (key: string): string =>
    `${prefix}${key.charAt(0).toUpperCase()}${key.slice(1)}`;

  return {
    initializeThread: acts[p("initializeThread")],
    appendHumanMessage: acts[p("appendHumanMessage")],
    appendToolResult: acts[p("appendToolResult")],
    appendSystemMessage: acts[p("appendSystemMessage")],
    forkThread: acts[p("forkThread")],
  } as ActivityInterfaceFor<ThreadOps>;
}
