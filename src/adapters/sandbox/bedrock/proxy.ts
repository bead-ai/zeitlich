/**
 * Workflow-safe proxy for Bedrock sandbox operations.
 *
 * Uses longer timeouts than in-memory providers since Bedrock
 * sandboxes are remote and creation involves provisioning.
 *
 * Import this from `zeitlich/adapters/sandbox/bedrock/workflow`
 * in your Temporal workflow files.
 *
 * By default the scope is derived from `workflowInfo().workflowType`,
 * so activities are automatically namespaced per workflow.
 *
 * The Bedrock Code Interpreter only exposes base sandbox lifecycle
 * (`create`/`destroy`) — the returned proxy is typed with `TCaps = never`,
 * so calling `pauseSandbox` / `snapshotSandbox` / `forkSandbox` / etc.
 * on it is a TypeScript error rather than a runtime throw.
 *
 * @example
 * ```typescript
 * import { proxyBedrockSandboxOps } from 'zeitlich/adapters/sandbox/bedrock/workflow';
 *
 * const sandbox = proxyBedrockSandboxOps();
 * ```
 */
import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import type { SandboxOps } from "../../../lib/sandbox/types";
import type { BedrockSandboxCreateOptions } from "./types";

const ADAPTER_PREFIX = "bedrock";

export function proxyBedrockSandboxOps(
  scope?: string,
  options?: Parameters<typeof proxyActivities>[0]
): SandboxOps<BedrockSandboxCreateOptions, unknown, never> {
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
  } as SandboxOps<BedrockSandboxCreateOptions, unknown, never>;
}
