/**
 * Workflow-safe proxy for in-memory sandbox operations.
 *
 * Import this from `zeitlich/adapters/sandbox/inmemory/workflow`
 * in your Temporal workflow files.
 *
 * By default the scope is derived from `workflowInfo().workflowType`,
 * so activities are automatically namespaced per workflow.
 *
 * @example
 * ```typescript
 * import { proxyInMemorySandboxOps } from 'zeitlich/adapters/sandbox/inmemory/workflow';
 *
 * // Auto-scoped to the current workflow name
 * const sandbox = proxyInMemorySandboxOps();
 * ```
 */
import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import type {
  SandboxCreateOptions,
  SandboxOps,
} from "../../../lib/sandbox/types";
import type { InMemoryCaps } from "./index";

const ADAPTER_PREFIX = "inMemory";

export function proxyInMemorySandboxOps(
  scope?: string,
  options?: Parameters<typeof proxyActivities>[0]
): SandboxOps<SandboxCreateOptions, unknown, InMemoryCaps> {
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

  const prefix = `${ADAPTER_PREFIX}${resolvedScope.charAt(0).toUpperCase()}${resolvedScope.slice(1)}`;
  const p = (key: string): string =>
    `${prefix}${key.charAt(0).toUpperCase()}${key.slice(1)}`;

  return {
    createSandbox: acts[p("createSandbox")],
    destroySandbox: acts[p("destroySandbox")],
    pauseSandbox: acts[p("pauseSandbox")],
    resumeSandbox: acts[p("resumeSandbox")],
    snapshotSandbox: acts[p("snapshotSandbox")],
    restoreSandbox: acts[p("restoreSandbox")],
    deleteSandboxSnapshot: acts[p("deleteSandboxSnapshot")],
    forkSandbox: acts[p("forkSandbox")],
  } as SandboxOps<SandboxCreateOptions, unknown, InMemoryCaps>;
}
