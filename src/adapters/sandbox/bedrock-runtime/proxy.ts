/**
 * Workflow-safe proxy for Bedrock AgentCore Runtime sandbox operations.
 *
 * Uses longer timeouts than in-memory providers since Runtime sessions are
 * remote and the first invoke into a fresh session provisions a microVM.
 *
 * Import this from `zeitlich/adapters/sandbox/bedrock-runtime/workflow`
 * in your Temporal workflow files.
 *
 * By default the scope is derived from `workflowInfo().workflowType`,
 * so activities are automatically namespaced per workflow.
 *
 * @example
 * ```typescript
 * import { proxyBedrockRuntimeSandboxOps } from 'zeitlich/adapters/sandbox/bedrock-runtime/workflow';
 *
 * const sandbox = proxyBedrockRuntimeSandboxOps();
 * ```
 */
import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import type { SandboxOps } from "../../../lib/sandbox/types";
import type { BedrockRuntimeSandboxCreateOptions } from "./types";

const ADAPTER_PREFIX = "bedrockRuntime";

export function proxyBedrockRuntimeSandboxOps(
  scope?: string,
  options?: Parameters<typeof proxyActivities>[0]
): SandboxOps<BedrockRuntimeSandboxCreateOptions> {
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
    restoreSandbox: acts[p("restoreSandbox")],
    deleteSandboxSnapshot: acts[p("deleteSandboxSnapshot")],
    forkSandbox: acts[p("forkSandbox")],
  } as SandboxOps<BedrockRuntimeSandboxCreateOptions>;
}
