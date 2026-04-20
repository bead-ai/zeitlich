/**
 * Workflow-safe proxy for runAgent activities with LLM-optimised defaults.
 *
 * Resolves the activity name from the scope using the same convention as
 * {@link createRunAgentActivity}: `run<Scope>`.
 * When no scope is provided, defaults to `workflowInfo().workflowType`.
 *
 * Import this from `zeitlich/workflow` in your Temporal workflow files.
 *
 * @typeParam M - SDK-native message type (e.g. `StoredMessage` for LangChain,
 *   `Anthropic.Messages.Message` for Anthropic, `Content` for Google GenAI).
 *   Must be provided for `SessionResult.finalMessage` to be correctly typed.
 *
 * @example
 * ```typescript
 * import { proxyRunAgent } from 'zeitlich/workflow';
 * import type { StoredMessage } from '@langchain/core/messages';
 *
 * // Auto-scoped to the current workflow name
 * const runAgent = proxyRunAgent<StoredMessage>();
 *
 * // Explicit scope for subagents
 * const runResearcher = proxyRunAgent<StoredMessage>("Researcher");
 * ```
 */
import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import type { AgentResponse } from "./types";
import type { RunAgentConfig } from "../types";

export function proxyRunAgent<M = unknown>(
  scope?: string,
  options?: Parameters<typeof proxyActivities>[0]
): (config: RunAgentConfig) => Promise<AgentResponse<M>> {
  const resolvedScope = scope ?? workflowInfo().workflowType;
  const name = `run${resolvedScope.charAt(0).toUpperCase()}${resolvedScope.slice(1)}`;
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
    }
  );
  return acts[name] as (config: RunAgentConfig) => Promise<AgentResponse<M>>;
}
