import type { AgentResponse, SerializableToolDefinition } from "./types";

/**
 * Configuration passed to a ModelInvoker.
 */
export interface ModelInvokerConfig {
  threadId: string;
  agentName: string;
  tools: SerializableToolDefinition[];
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
