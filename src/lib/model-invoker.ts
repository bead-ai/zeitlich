import type { AgentResponse, RunAgentConfig } from "./types";

/**
 * Configuration passed to a ModelInvoker.
 * Tools are NOT passed here — implementations should load them
 * via `queryParentWorkflowState` using `agentQueryName(config.agentName)`.
 */
export type ModelInvokerConfig = RunAgentConfig;

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
