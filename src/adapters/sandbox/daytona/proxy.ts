/**
 * Workflow-safe proxy for Daytona sandbox operations.
 *
 * Uses longer timeouts than in-memory providers since Daytona
 * sandboxes are remote and creation involves provisioning.
 *
 * Import this from `zeitlich/adapters/sandbox/daytona/workflow`
 * in your Temporal workflow files.
 *
 * @example
 * ```typescript
 * import { proxyDaytonaSandboxOps } from 'zeitlich/adapters/sandbox/daytona/workflow';
 *
 * const session = await createSession({
 *   sandbox: proxyDaytonaSandboxOps(),
 *   // ...
 * });
 * ```
 */
import { proxyActivities } from "@temporalio/workflow";
import type { SandboxOps, PrefixedSandboxOps } from "../../../lib/sandbox/types";

export function proxyDaytonaSandboxOps(
  options?: Parameters<typeof proxyActivities>[0]
): SandboxOps {
  const acts = proxyActivities<PrefixedSandboxOps<"daytona">>(
    options ?? {
      startToCloseTimeout: "120s",
      retry: {
        maximumAttempts: 3,
        initialInterval: "5s",
        maximumInterval: "60s",
        backoffCoefficient: 3,
      },
    }
  );

  return {
    createSandbox: acts.daytonaCreateSandbox,
    destroySandbox: acts.daytonaDestroySandbox,
    snapshotSandbox: acts.daytonaSnapshotSandbox,
  };
}
