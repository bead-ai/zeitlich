import type { TokenUsage, BaseAgentState, RunAgentConfig } from "../types";
import type { RawToolCall } from "../tool-router/types";

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
  config: RunAgentConfig
) => Promise<AgentResponse<M>>;

/**
 * Configuration passed to a ModelInvoker.
 * Includes the full agent state so adapters can read tools, system prompt,
 * token usage, or any custom state fields for model configuration.
 */
export interface ModelInvokerConfig {
  threadId: string;
  /** Redis key suffix for thread storage. Defaults to 'messages'. */
  threadKey?: string;
  agentName: string;
  state: BaseAgentState;
  metadata?: Record<string, unknown>;
  /**
   * The id the assistant message produced by this call will be stored
   * under. Invokers truncate the thread from this id on entry so that
   * rewind retries and Temporal workflow resets restore the pre-call
   * state before re-invoking the LLM. See {@link RunAgentConfig}.
   */
  assistantMessageId: string;
}

/**
 * Generic model invocation contract.
 * Implementations load the thread, call the LLM, and return a normalised
 * AgentResponse. The caller (workflow) is responsible for appending the
 * response to the thread with a deterministic ID.
 *
 * Framework adapters (e.g. `zeitlich/langchain`) provide concrete
 * implementations of this type.
 */
export type ModelInvoker<M = unknown> = (
  config: ModelInvokerConfig
) => Promise<AgentResponse<M>>;
