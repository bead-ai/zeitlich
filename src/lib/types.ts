// ============================================================================
// Agent core types
// ============================================================================

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
  tools: SerializableToolDefinition[];
  status: AgentStatus;
  version: number;
  turns: number;
  tasks: Map<string, WorkflowTask>;
  systemPrompt?: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  cachedWriteTokens: number;
  cachedReadTokens: number;
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

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedWriteTokens?: number;
  cachedReadTokens?: number;
  reasonTokens?: number;
}

/**
 * Configuration for a Zeitlich agent
 */
export interface AgentConfig {
  /** The name of the agent, should be unique within the workflows, ideally Pascal Case */
  agentName: string;
  /** Description, used for sub agents */
  description?: string;
}

/**
 * A JSON-serializable tool definition for state storage.
 * Uses a plain JSON Schema object instead of a live Zod instance,
 * so it survives Temporal serialization without losing constraints (min, max, etc.).
 */
export interface SerializableToolDefinition {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  strict?: boolean;
  max_uses?: number;
}

/**
 * Configuration passed to runAgent activity
 */
export interface RunAgentConfig extends AgentConfig {
  /** The thread ID to use for the session */
  threadId: string;
  /** Redis key suffix for thread storage. Defaults to 'messages'. */
  threadKey?: string;
  /** Metadata for the session */
  metadata?: Record<string, unknown>;
}

/**
 * Configuration for appending a tool result
 */
export interface ToolResultConfig {
  threadId: string;
  /** Redis key suffix for thread storage. Defaults to 'messages'. */
  threadKey?: string;
  toolCallId: string;
  /** The name of the tool that produced this result */
  toolName: string;
  /** Content for the tool message (JSON-serialized result) */
  content: string;
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
// Session exit
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
 * Helper to check if status is terminal
 */
export function isTerminalStatus(status: AgentStatus): boolean {
  return (
    status === "COMPLETED" || status === "FAILED" || status === "CANCELLED"
  );
}
