/**
 * Workflow-safe proxy for virtual filesystem operations.
 *
 * Import this from `zeitlich/workflow` in your Temporal workflow files.
 *
 * By default the scope is derived from `workflowInfo().workflowType`,
 * so activities are automatically namespaced per workflow.
 *
 * @example
 * ```typescript
 * import { proxyVirtualFsOps } from 'zeitlich/workflow';
 *
 * const virtualFsOps = proxyVirtualFsOps();
 * ```
 */
import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import type { VirtualFsOps } from "./types";

export function proxyVirtualFsOps<TCtx = unknown>(
  scope?: string,
  options?: Parameters<typeof proxyActivities>[0],
): VirtualFsOps<TCtx> {
  const resolvedScope = scope ?? workflowInfo().workflowType;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const acts = proxyActivities<Record<string, (...args: any[]) => any>>(
    options ?? {
      startToCloseTimeout: "30s",
      retry: {
        maximumAttempts: 3,
        initialInterval: "2s",
        maximumInterval: "30s",
        backoffCoefficient: 2,
      },
    },
  );

  const prefix = resolvedScope;
  const p = (key: string): string =>
    `${prefix}${key.charAt(0).toUpperCase()}${key.slice(1)}`;

  return {
    resolveFileTree: acts[p("resolveFileTree")],
  } as VirtualFsOps<TCtx>;
}
