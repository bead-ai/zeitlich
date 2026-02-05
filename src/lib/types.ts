import type { ToolMessageContent } from "./thread-manager";
import type {
  ParsedToolCallUnion,
  ToolDefinition,
  ToolMap,
} from "./tool-router";

import type { StoredMessage } from "@langchain/core/messages";
import type { z } from "zod";

/**
 * Agent execution status
 */
export type AgentStatus =
  | "RUNNING"
  | "WAITING_FOR_INPUT"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

/**
 * Base state that all agents must have
 */
export interface BaseAgentState {
  status: AgentStatus;
  version: number;
  turns: number;
  tasks: Map<string, WorkflowTask>;
}

/**
 * File representation for agent workflows
 */
export interface AgentFile {
  /** Database/S3 file ID */
  id: string;
  /** Virtual path for agent (e.g., "evidence/invoice.pdf") */
  path: string;
  /** Original filename */
  filename: string;
  /** Generic description for prompt */
  description?: string;
  /** MIME type of the file */
  mimeType?: string;
}

/**
 * Agent response from LLM invocation
 */
export interface AgentResponse {
  message: StoredMessage;
  stopReason: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Configuration for a Zeitlich agent session
 */
export interface ZeitlichAgentConfig {
  threadId: string;
  agentName: string;
  metadata?: Record<string, unknown>;
  maxTurns?: number;
}

/**
 * Configuration passed to runAgent activity
 */
export interface RunAgentConfig {
  threadId: string;
  agentName: string;
  metadata?: Record<string, unknown>;
  tools?: ToolDefinition[];
}

/**
 * Type signature for workflow-specific runAgent activity
 */
export type RunAgentActivity = (
  config: RunAgentConfig,
  invocationConfig: InvocationConfig
) => Promise<AgentResponse>;

/**
 * Per-invocation configuration passed to runAgent
 */
export interface InvocationConfig {
  systemPrompt: string;
}

/**
 * Configuration for appending a tool result
 */
export interface ToolResultConfig {
  threadId: string;
  toolCallId: string;
  /** Content for the tool message (string or complex content parts) */
  content: ToolMessageContent;
}

// ============================================================================
// Subagent Configuration
// ============================================================================

/**
 * Configuration for a subagent that can be spawned by the parent workflow.
 *
 * @template TResult - Zod schema type for validating the child workflow's result
 */
export interface SubagentConfig<TResult extends z.ZodType = z.ZodType> {
  /** Identifier used in Task tool's subagent parameter */
  name: string;
  /** Description shown to the parent agent explaining what this subagent does */
  description: string;
  /** Temporal workflow type name (used with executeChild) */
  workflowType: string;
  /** Optional task queue - defaults to parent's queue if not specified */
  taskQueue?: string;
  /** Optional Zod schema to validate the child workflow's result. If omitted, result is passed through as-is. */
  resultSchema?: TResult;
}

/**
 * Input passed to child workflows when spawned as subagents
 */
export interface SubagentInput {
  /** The prompt/task from the parent agent */
  prompt: string;
}

// ============================================================================
// Workflow Tasks
// ============================================================================

/**
 * Status of a workflow task
 */
export type TaskStatus = "pending" | "in_progress" | "completed";

/**
 * A task managed within a workflow for tracking work items
 */
export interface WorkflowTask {
  /** Unique task identifier */
  id: string;
  /** Brief, actionable title in imperative form */
  subject: string;
  /** Detailed description of what needs to be done */
  description: string;
  /** Present continuous form shown in spinner when in_progress */
  activeForm: string;
  /** Current status of the task */
  status: TaskStatus;
  /** Arbitrary key-value pairs for tracking */
  metadata: Record<string, string>;
  /** IDs of tasks that must complete before this one can start */
  blockedBy: string[];
  /** IDs of tasks that are waiting for this one to complete */
  blocks: string[];
}

// ============================================================================
// Session Lifecycle Hooks
// ============================================================================

/**
 * Exit reasons for session termination
 */
export type SessionExitReason =
  | "completed"
  | "max_turns"
  | "waiting_for_input"
  | "failed"
  | "cancelled";

/**
 * Context for PreToolUse hook - called before tool execution
 */
export interface PreToolUseHookContext<T extends ToolMap> {
  /** The tool call about to be executed */
  toolCall: ParsedToolCallUnion<T>;
  /** Thread identifier */
  threadId: string;
  /** Current turn number */
  turn: number;
}

/**
 * Result from PreToolUse hook - can block or modify execution
 */
export interface PreToolUseHookResult {
  /** Skip this tool call entirely */
  skip?: boolean;
  /** Modified args to use instead (must match schema) */
  modifiedArgs?: unknown;
}

/**
 * PreToolUse hook - called before tool execution, can block or modify
 */
export type PreToolUseHook<T extends ToolMap> = (
  ctx: PreToolUseHookContext<T>
) => PreToolUseHookResult | Promise<PreToolUseHookResult>;

/**
 * Context for PostToolUse hook - called after successful tool execution
 */
export interface PostToolUseHookContext<T extends ToolMap, TResult = unknown> {
  /** The tool call that was executed */
  toolCall: ParsedToolCallUnion<T>;
  /** The result from the tool handler */
  result: TResult;
  /** Thread identifier */
  threadId: string;
  /** Current turn number */
  turn: number;
  /** Execution duration in milliseconds */
  durationMs: number;
}

/**
 * PostToolUse hook - called after successful tool execution
 */
export type PostToolUseHook<T extends ToolMap, TResult = unknown> = (
  ctx: PostToolUseHookContext<T, TResult>
) => void | Promise<void>;

/**
 * Context for PostToolUseFailure hook - called when tool execution fails
 */
export interface PostToolUseFailureHookContext<T extends ToolMap> {
  /** The tool call that failed */
  toolCall: ParsedToolCallUnion<T>;
  /** The error that occurred */
  error: Error;
  /** Thread identifier */
  threadId: string;
  /** Current turn number */
  turn: number;
}

/**
 * Result from PostToolUseFailure hook - can recover from errors
 */
export interface PostToolUseFailureHookResult {
  /** Provide a fallback result instead of throwing */
  fallbackContent?: ToolMessageContent;
  /** Whether to suppress the error (still logs, but continues) */
  suppress?: boolean;
}

/**
 * PostToolUseFailure hook - called when tool execution fails
 */
export type PostToolUseFailureHook<T extends ToolMap> = (
  ctx: PostToolUseFailureHookContext<T>
) => PostToolUseFailureHookResult | Promise<PostToolUseFailureHookResult>;

/**
 * Context for SessionStart hook - called when session begins
 */
export interface SessionStartHookContext {
  /** Thread identifier */
  threadId: string;
  /** Name of the agent */
  agentName: string;
  /** Session metadata */
  metadata: Record<string, unknown>;
}

/**
 * SessionStart hook - called when session begins
 */
export type SessionStartHook = (
  ctx: SessionStartHookContext
) => void | Promise<void>;

/**
 * Context for SessionEnd hook - called when session ends
 */
export interface SessionEndHookContext {
  /** Thread identifier */
  threadId: string;
  /** Name of the agent */
  agentName: string;
  /** Reason the session ended */
  exitReason: SessionExitReason;
  /** Total turns executed */
  turns: number;
  /** Session metadata */
  metadata: Record<string, unknown>;
}

/**
 * SessionEnd hook - called when session ends
 */
export type SessionEndHook = (
  ctx: SessionEndHookContext
) => void | Promise<void>;

/**
 * Combined hooks interface for session lifecycle
 */
export interface SessionHooks<T extends ToolMap, TResult = unknown> {
  /** Called before each tool execution - can block or modify */
  onPreToolUse?: PreToolUseHook<T>;
  /** Called after each successful tool execution */
  onPostToolUse?: PostToolUseHook<T, TResult>;
  /** Called when tool execution fails */
  onPostToolUseFailure?: PostToolUseFailureHook<T>;
  /** Called when session starts */
  onSessionStart?: SessionStartHook;
  /** Called when session ends */
  onSessionEnd?: SessionEndHook;
}

/**
 * Helper to check if status is terminal
 */
export function isTerminalStatus(status: AgentStatus): boolean {
  return (
    status === "COMPLETED" || status === "FAILED" || status === "CANCELLED"
  );
}
