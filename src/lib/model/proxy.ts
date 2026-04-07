/**
 * Workflow-safe proxy for runAgent activities with LLM-optimised defaults.
 *
 * Import this from `zeitlich/workflow` in your Temporal workflow files.
 *
 * @example
 * ```typescript
 * import { proxyRunAgent } from 'zeitlich/workflow';
 *
 * const runAgent = proxyRunAgent("runAgent");
 * const runResearcher = proxyRunAgent("runResearcherActivity");
 * ```
 */
import { proxyActivities } from "@temporalio/workflow";
import type { AgentResponse } from "./types";
import type { RunAgentConfig } from "../types";

export function proxyRunAgent<M = unknown>(
  activityName: string,
  options?: Parameters<typeof proxyActivities>[0],
): (config: RunAgentConfig) => Promise<AgentResponse<M>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const acts = proxyActivities<Record<string, (...args: any[]) => any>>(
    options ?? {
      startToCloseTimeout: "10m",
      heartbeatTimeout: "1m",
      retry: {
        maximumAttempts: 3,
        initialInterval: "10s",
        maximumInterval: "2m",
        backoffCoefficient: 3,
      },
    },
  );
  return acts[activityName] as (config: RunAgentConfig) => Promise<AgentResponse<M>>;
}
