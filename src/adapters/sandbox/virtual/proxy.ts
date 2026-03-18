/**
 * Workflow-safe proxy for virtual sandbox operations.
 *
 * Import this from `zeitlich/adapters/sandbox/virtual/workflow`
 * in your Temporal workflow files.
 *
 * By default the scope is derived from `workflowInfo().workflowType`,
 * so activities are automatically namespaced per workflow.
 *
 * @example
 * ```typescript
 * import { proxyVirtualSandboxOps } from 'zeitlich/adapters/sandbox/virtual/workflow';
 *
 * const sandbox = proxyVirtualSandboxOps();
 * ```
 */
import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import type {
  DestroySandboxActivity,
  SandboxOps,
} from "../../../lib/sandbox/types";

const ADAPTER_PREFIX = "virtual";

export function proxyVirtualSandboxOps(
  scope?: string,
  options?: Parameters<typeof proxyActivities>[0]
): SandboxOps {
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
    }
  );

  const prefix =
    `${ADAPTER_PREFIX}${resolvedScope.charAt(0).toUpperCase()}${resolvedScope.slice(1)}`;
  const p = (key: string): string =>
    `${prefix}${key.charAt(0).toUpperCase()}${key.slice(1)}`;

  return {
    createSandbox: acts[p("createSandbox")],
    destroySandbox: acts[p("destroySandbox")] as unknown as DestroySandboxActivity,
    pauseSandbox: acts[p("pauseSandbox")],
    snapshotSandbox: acts[p("snapshotSandbox")],
    forkSandbox: acts[p("forkSandbox")],
  } as SandboxOps;
}
