/**
 * Workflow-safe proxy for virtual sandbox operations.
 *
 * Import this from `zeitlich/adapters/sandbox/virtual/workflow`
 * in your Temporal workflow files.
 *
 * @example
 * ```typescript
 * import { proxyVirtualSandboxOps } from 'zeitlich/adapters/sandbox/virtual/workflow';
 *
 * const session = await createSession({
 *   sandbox: proxyVirtualSandboxOps(),
 *   // ...
 * });
 * ```
 */
import { proxyActivities } from "@temporalio/workflow";
import type { SandboxOps, PrefixedSandboxOps } from "../../../lib/sandbox/types";

export function proxyVirtualSandboxOps(
  options?: Parameters<typeof proxyActivities>[0]
): SandboxOps {
  const acts = proxyActivities<PrefixedSandboxOps<"virtual">>(
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

  return {
    createSandbox: acts.virtualCreateSandbox,
    destroySandbox: acts.virtualDestroySandbox,
    snapshotSandbox: acts.virtualSnapshotSandbox,
  };
}
