/**
 * Workflow-safe proxy for Daytona sandbox operations.
 *
 * Uses longer timeouts than in-memory providers since Daytona
 * sandboxes are remote and creation involves provisioning.
 *
 * Import this from `zeitlich/adapters/sandbox/daytona/workflow`
 * in your Temporal workflow files.
 *
 * By default the scope is derived from `workflowInfo().workflowType`,
 * so activities are automatically namespaced per workflow.
 *
 * @example
 * ```typescript
 * import { proxyDaytonaSandboxOps } from 'zeitlich/adapters/sandbox/daytona/workflow';
 *
 * const sandbox = proxyDaytonaSandboxOps();
 * ```
 */
import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import type { SandboxOps } from "../../../lib/sandbox/types";
import type { DaytonaSandboxCreateOptions } from "./types";

const ADAPTER_PREFIX = "daytona";

export function proxyDaytonaSandboxOps(
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
  } as SandboxOps<DaytonaSandboxCreateOptions>;
}
