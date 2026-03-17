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
 * const sandbox = proxyVirtualSandboxOps("main");
 * ```
 */
import { proxyActivities } from "@temporalio/workflow";
import type { SandboxOps } from "../../../lib/sandbox/types";

const ADAPTER_PREFIX = "virtual";

export function proxyVirtualSandboxOps(
  scope?: string,
  options?: Parameters<typeof proxyActivities>[0]
): SandboxOps {
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
