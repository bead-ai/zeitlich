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
 * const session = await createSession({
 *   threadOps: proxyLangChainThreadOps(),
 *   // ...
 * });
 * ```
 */
import {
  proxyActivities,
  type ActivityInterfaceFor,
} from "@temporalio/workflow";
import type { ThreadOps, PrefixedThreadOps } from "../../../lib/session/types";

export function proxyLangChainThreadOps(
  options?: Parameters<typeof proxyActivities>[0]
): ActivityInterfaceFor<ThreadOps> {
  const acts = proxyActivities<PrefixedThreadOps<"langChain">>(
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

  return {
    initializeThread: acts.langChainInitializeThread,
    appendHumanMessage: acts.langChainAppendHumanMessage,
    appendToolResult: acts.langChainAppendToolResult,
    appendSystemMessage: acts.langChainAppendSystemMessage,
    forkThread: acts.langChainForkThread,
  };
}
