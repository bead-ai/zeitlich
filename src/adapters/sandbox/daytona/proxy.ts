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
 * const sandbox = proxyDaytonaSandboxOps("main");
 * ```
 */
import { proxyActivities } from "@temporalio/workflow";
import type { SandboxOps } from "../../../lib/sandbox/types";

const ADAPTER_PREFIX = "daytona";

export function proxyDaytonaSandboxOps(
  scope?: string,
  options?: Parameters<typeof proxyActivities>[0]
): SandboxOps {
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

  const prefix = scope
    ? `${scope}${ADAPTER_PREFIX.charAt(0).toUpperCase()}${ADAPTER_PREFIX.slice(1)}`
    : ADAPTER_PREFIX;
  const p = (key: string): string =>
    `${prefix}${key.charAt(0).toUpperCase()}${key.slice(1)}`;

  return {
    createSandbox: acts[p("createSandbox")],
    destroySandbox: acts[p("destroySandbox")],
    snapshotSandbox: acts[p("snapshotSandbox")],
  } as SandboxOps;
}
