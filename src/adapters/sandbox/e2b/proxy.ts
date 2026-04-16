/**
 * Workflow-safe proxy for E2B sandbox operations.
 *
 * Uses longer timeouts than in-memory providers since E2B
 * sandboxes are remote and creation involves provisioning.
 *
 * Import this from `zeitlich/adapters/sandbox/e2b/workflow`
 * in your Temporal workflow files.
 *
 * By default the scope is derived from `workflowInfo().workflowType`,
 * so activities are automatically namespaced per workflow.
 *
 * @example
 * ```typescript
 * import { proxyE2bSandboxOps } from 'zeitlich/adapters/sandbox/e2b/workflow';
 *
 * const sandbox = proxyE2bSandboxOps();
 * ```
 */
import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import type { SandboxOps } from "../../../lib/sandbox/types";
import type { E2bSandboxCreateOptions } from "./types";

const ADAPTER_PREFIX = "e2b";

export function proxyE2bSandboxOps(
  scope?: string,
  options?: Parameters<typeof proxyActivities>[0]
): SandboxOps {
  const resolvedScope = scope ?? workflowInfo().workflowType;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const acts = proxyActivities<Record<string, (...args: any[]) => any>>(
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

  const prefix = `${ADAPTER_PREFIX}${resolvedScope.charAt(0).toUpperCase()}${resolvedScope.slice(1)}`;
  const p = (key: string): string =>
    `${prefix}${key.charAt(0).toUpperCase()}${key.slice(1)}`;

  return {
    createSandbox: acts[p("createSandbox")],
    destroySandbox: acts[p("destroySandbox")],
    pauseSandbox: acts[p("pauseSandbox")],
    resumeSandbox: acts[p("resumeSandbox")],
    snapshotSandbox: acts[p("snapshotSandbox")],
    forkSandbox: acts[p("forkSandbox")],
    deleteSnapshot: acts[p("deleteSnapshot")],
  } as SandboxOps<E2bSandboxCreateOptions>;
}
