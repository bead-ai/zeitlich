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
import { type ActivityInterfaceFor } from "@temporalio/workflow";
import type { ThreadOps } from "../../../lib/session/types";
import type { LangChainContent } from "./thread-manager";
import { createThreadOpsProxy } from "../../../lib/thread/proxy";

const ADAPTER_PREFIX = "langChain";

export function proxyLangChainThreadOps(
  scope?: string,
  options?: Parameters<typeof createThreadOpsProxy>[2],
): ActivityInterfaceFor<ThreadOps<LangChainContent>> {
  return createThreadOpsProxy(ADAPTER_PREFIX, scope, options) as ActivityInterfaceFor<ThreadOps<LangChainContent>>;
}
