import type { TokenUsage, BaseAgentState, RunAgentConfig } from "../types";
import type { RawToolCall } from "../tool-router/types";

/**
 * Agent response from LLM invocation
 */
export interface AgentResponse<M = unknown> {
  message: M;
  rawToolCalls: RawToolCall[];
  usage?: TokenUsage;
  /**
   * Number of stored messages in the thread at the moment the LLM was
   * invoked — i.e. *before* the assistant message is appended. The
   * session uses this as a rewind snapshot so it can roll the thread
   * back to this exact state if a tool requests a rewind.
   *
   * Adapters compute this for free from the array of stored messages
   * they load when preparing the payload.
   */
  threadLengthAtCall?: number;
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
