/**
 * Workflow-safe proxy for Anthropic thread operations.
 *
 * Import this from `zeitlich/adapters/thread/anthropic/workflow`
 * in your Temporal workflow files.
 *
 * By default the scope is derived from `workflowInfo().workflowType`,
 * so activities are automatically namespaced per workflow.
 *
 * @example
 * ```typescript
 * import { proxyAnthropicThreadOps } from 'zeitlich/adapters/thread/anthropic/workflow';
 *
 * // Auto-scoped to the current workflow name
 * const threadOps = proxyAnthropicThreadOps();
 *
 * // Explicit scope override
 * const threadOps = proxyAnthropicThreadOps("customScope");
 * ```
 */
import {
  proxyActivities,
  workflowInfo,
  type ActivityInterfaceFor,
} from "@temporalio/workflow";
import type { ThreadOps } from "../../../lib/session/types";

const ADAPTER_PREFIX = "anthropic";

export function proxyAnthropicThreadOps(
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
    `${ADAPTER_PREFIX}${resolvedScope.charAt(0).toUpperCase()}${resolvedScope.slice(1)}`;
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
