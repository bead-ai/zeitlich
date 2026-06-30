/**
 * Workflow-safe proxy for AWS Bedrock AgentCore browser-session operations.
 *
 * Import this from `zeitlich/adapters/browser/agentcore/workflow` in your
 * Temporal workflow files. By default the scope is derived from
 * `workflowInfo().workflowType`, so activities are automatically namespaced
 * per workflow.
 *
 * AgentCore browser providers are minimal-cap — the returned proxy only
 * exposes `createBrowser` / `destroyBrowser`.
 *
 * @example
 * ```typescript
 * import { proxyAgentCoreBrowserOps } from 'zeitlich/adapters/browser/agentcore/workflow';
 *
 * const browser = proxyAgentCoreBrowserOps();
 * ```
 */
import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import type { BrowserSessionOps } from "../../../lib/browser/types";
import type { AgentCoreBrowserCreateOptions } from "./types";

const ADAPTER_PREFIX = "agentcoreBrowser";

export function proxyAgentCoreBrowserOps(
  scope?: string,
  options?: Parameters<typeof proxyActivities>[0]
): BrowserSessionOps<AgentCoreBrowserCreateOptions, unknown> {
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
    createBrowser: acts[p("createBrowser")],
    destroyBrowser: acts[p("destroyBrowser")],
  } as BrowserSessionOps<AgentCoreBrowserCreateOptions, unknown>;
}
