/**
 * Workflow-safe proxy for Google GenAI thread operations.
 *
 * Import this from `zeitlich/adapters/thread/google-genai/workflow`
 * in your Temporal workflow files.
 *
 * @example
 * ```typescript
 * import { proxyGoogleGenAIThreadOps } from 'zeitlich/adapters/thread/google-genai/workflow';
 *
 * const session = await createSession({
 *   threadOps: proxyGoogleGenAIThreadOps(),
 *   // ...
 * });
 * ```
 */
import {
  proxyActivities,
  type ActivityInterfaceFor,
} from "@temporalio/workflow";
import type { ThreadOps, PrefixedThreadOps } from "../../../lib/session/types";

export function proxyGoogleGenAIThreadOps(
  options?: Parameters<typeof proxyActivities>[0]
): ActivityInterfaceFor<ThreadOps> {
  const acts = proxyActivities<PrefixedThreadOps<"googleGenAI">>(
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
    initializeThread: acts.googleGenAIInitializeThread,
    appendHumanMessage: acts.googleGenAIAppendHumanMessage,
    appendToolResult: acts.googleGenAIAppendToolResult,
    appendSystemMessage: acts.googleGenAIAppendSystemMessage,
    forkThread: acts.googleGenAIForkThread,
  };
}
