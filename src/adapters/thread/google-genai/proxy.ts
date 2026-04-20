/**
 * Workflow-safe proxy for Google GenAI thread operations.
 *
 * Import this from `zeitlich/adapters/thread/google-genai/workflow`
 * in your Temporal workflow files.
 *
 * By default the scope is derived from `workflowInfo().workflowType`,
 * so activities are automatically namespaced per workflow.
 *
 * @example
 * ```typescript
 * import { proxyGoogleGenAIThreadOps } from 'zeitlich/adapters/thread/google-genai/workflow';
 *
 * // Auto-scoped to the current workflow name
 * const threadOps = proxyGoogleGenAIThreadOps();
 *
 * // Explicit scope override
 * const threadOps = proxyGoogleGenAIThreadOps("customScope");
 * ```
 */
import { type ActivityInterfaceFor } from "@temporalio/workflow";
import type { ThreadOps } from "../../../lib/session/types";
import type { GoogleGenAIContent } from "./thread-manager";
import { createThreadOpsProxy } from "../../../lib/thread/proxy";

const ADAPTER_PREFIX = "googleGenAI";

export function proxyGoogleGenAIThreadOps(
  scope?: string,
  options?: Parameters<typeof createThreadOpsProxy>[2]
): ActivityInterfaceFor<ThreadOps<GoogleGenAIContent>> {
  return createThreadOpsProxy(
    ADAPTER_PREFIX,
    scope,
    options
  ) as ActivityInterfaceFor<ThreadOps<GoogleGenAIContent>>;
}
