import type { RawToolCall } from "../tool-router/types";
import type { BaseAgentState, RunAgentConfig, TokenUsage } from "../types";

/**
 * Agent response from LLM invocation
 */
export interface AgentResponse<M = unknown> {
  message: M;
  rawToolCalls: RawToolCall[];
  usage?: TokenUsage;
}

/**
 * Type signature for workflow-specific runAgent activity
 */
export type RunAgentActivity<M = unknown> = (
  config: RunAgentConfig,
) => Promise<AgentResponse<M>>;

/**
 * Configuration passed to a ModelInvoker.
 * Includes the full agent state so adapters can read tools, system prompt,
 * token usage, or any custom state fields for model configuration.
 */
export interface ModelInvokerConfig {
  threadId: string;
  agentName: string;
  state: BaseAgentState;
  metadata?: Record<string, unknown>;
}

/**
 * Generic model invocation contract.
 * Implementations load the thread, call the LLM, append the response,
 * and return a normalised AgentResponse.
 *
 * Framework adapters (e.g. `zeitlich/langchain`) provide concrete
 * implementations of this type.
 */
export type ModelInvoker<M = unknown> = (
  config: ModelInvokerConfig,
) => Promise<AgentResponse<M>>;
