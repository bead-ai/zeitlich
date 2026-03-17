/**
 * Workflow-safe proxy for LangChain thread operations.
 *
 * Import this from `zeitlich/adapters/thread/langchain/workflow`
 * in your Temporal workflow files.
 *
 * @example
 * ```typescript
 * import { proxyLangChainThreadOps } from 'zeitlich/adapters/thread/langchain/workflow';
 *
 * // Main agent
 * const threadOps = proxyLangChainThreadOps("main");
 *
 * // Subagent with its own scoped activities
 * const researchThreadOps = proxyLangChainThreadOps("research");
 * ```
 */
import {
  proxyActivities,
  type ActivityInterfaceFor,
} from "@temporalio/workflow";
import type { ThreadOps } from "../../../lib/session/types";

const ADAPTER_PREFIX = "langChain";

export function proxyLangChainThreadOps(
  scope?: string,
  options?: Parameters<typeof proxyActivities>[0]
): ActivityInterfaceFor<ThreadOps> {
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

  const prefix = scope
    ? `${scope}${ADAPTER_PREFIX.charAt(0).toUpperCase()}${ADAPTER_PREFIX.slice(1)}`
    : ADAPTER_PREFIX;
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
