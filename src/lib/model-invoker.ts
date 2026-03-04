import type { AgentResponse, BaseAgentState } from "./types";

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
  config: ModelInvokerConfig
) => Promise<AgentResponse<M>>;
