/**
 * Workflow-safe proxy for in-memory sandbox operations.
 *
 * Import this from `zeitlich/adapters/sandbox/inmemory/workflow`
 * in your Temporal workflow files.
 *
 * @example
 * ```typescript
 * import { proxyInMemorySandboxOps } from 'zeitlich/adapters/sandbox/inmemory/workflow';
 *
 * const session = await createSession({
 *   sandbox: proxyInMemorySandboxOps(),
 *   // ...
 * });
 * ```
 */
import { proxyActivities } from "@temporalio/workflow";
import type { SandboxOps, PrefixedSandboxOps } from "../../../lib/sandbox/types";

export function proxyInMemorySandboxOps(
  options?: Parameters<typeof proxyActivities>[0]
): SandboxOps {
  const acts = proxyActivities<PrefixedSandboxOps<"inMemory">>(
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
    createSandbox: acts.inMemoryCreateSandbox,
    destroySandbox: acts.inMemoryDestroySandbox,
    snapshotSandbox: acts.inMemorySnapshotSandbox,
  };
}
