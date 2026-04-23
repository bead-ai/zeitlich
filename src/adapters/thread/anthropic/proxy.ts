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
import { type ActivityInterfaceFor } from "@temporalio/workflow";
import type { ThreadOps } from "../../../lib/session/types";
import type { AnthropicContent } from "./thread-manager";
import { createThreadOpsProxy } from "../../../lib/thread/proxy";
import { ADAPTER_ID } from "./adapter-id";

export { ADAPTER_ID, type AdapterId } from "./adapter-id";

export function proxyAnthropicThreadOps(
  scope?: string,
  options?: Parameters<typeof createThreadOpsProxy>[2]
): ActivityInterfaceFor<ThreadOps<AnthropicContent>> {
  return createThreadOpsProxy(
    ADAPTER_ID,
    scope,
    options
  ) as ActivityInterfaceFor<ThreadOps<AnthropicContent>>;
}
