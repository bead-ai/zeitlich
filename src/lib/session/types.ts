import type { Duration } from "@temporalio/common";
import type {
  MessageContent,
  ToolResultConfig,
  SessionExitReason,
} from "../types";
import type {
  ToolMap,
  ToolCallResultUnion,
  InferToolResults,
} from "../tool-router/types";
import type { Hooks } from "../hooks/types";
import type { SubagentConfig, SubagentInput } from "../subagent/types";
import type { Skill } from "../skills/types";
import type { SandboxOps } from "../sandbox/types";
import type { RunAgentActivity } from "../model/types";
import type { AgentStateManager, JsonSerializable } from "../state/types";

/**
 * Thread operations required by a session.
 * Consumers provide these — typically by wrapping Temporal activities.
 */
export interface ThreadOps {
  /** Initialize an empty thread */
  initializeThread(threadId: string): Promise<void>;
  /** Append a human message to the thread */
  appendHumanMessage(
    threadId: string,
    content: string | MessageContent
  ): Promise<void>;
  /** Append a tool result to the thread */
  appendToolResult(config: ToolResultConfig): Promise<void>;
  /** Append a system message to the thread */
  appendSystemMessage(threadId: string, content: string): Promise<void>;
  /** Copy all messages from sourceThreadId into a new thread at targetThreadId */
  forkThread(sourceThreadId: string, targetThreadId: string): Promise<void>;
}

/**
 * Configuration for a Zeitlich agent session
 */
export interface SessionConfig<T extends ToolMap, M = unknown> {
  /** The name of the agent, should be unique within the workflows */
  agentName: string;
  /** The thread ID to use for the session (defaults to a short generated ID) */
  threadId?: string;
  /** Metadata for the session */
  metadata?: Record<string, unknown>;
  /** Whether to append the system prompt as message to the thread */
  appendSystemPrompt?: boolean;
  /** How many turns to run the session for */
  maxTurns?: number;
  /** Workflow-specific runAgent activity (with tools pre-bound) */
  runAgent: RunAgentActivity<M>;
  /** Thread operations (initialize, append messages, parse tool calls) */
  threadOps?: ThreadOps;
  /** Tool router for processing tool calls (optional if agent has no tools) */
  tools?: T;
  /** Subagent configurations */
  subagents?: SubagentConfig[];
  /** Skills available to this agent (metadata + instructions, loaded activity-side) */
  skills?: Skill[];
  /** Session lifecycle hooks */
  hooks?: Hooks<T, ToolCallResultUnion<InferToolResults<T>>>;
  /** Whether to process tools in parallel */
  processToolsInParallel?: boolean;
  /**
   * Build context message content from agent-specific context.
   * Returns MessageContent array for the initial HumanMessage.
   */
  buildContextMessage: () => MessageContent | Promise<MessageContent>;
  /** When true, skip thread initialization and system prompt — append only the new human message to the existing thread. */
  continueThread?: boolean;
  /** How long to wait for input before cancelling the workflow */
  waitForInputTimeout?: Duration;
  /** Sandbox lifecycle operations (optional — omit for agents that don't need a sandbox) */
  sandbox?: SandboxOps;
  /**
   * Pre-existing sandbox ID to reuse (e.g. inherited from a parent agent).
   * When set, the session skips `createSandbox` and will not destroy the
   * sandbox on exit (the owner is responsible for cleanup).
   */
  sandboxId?: string;
}

export interface ZeitlichSession<M = unknown> {
  runSession<T extends JsonSerializable<T>>(args: {
    stateManager: AgentStateManager<T>;
  }): Promise<{
    threadId: string;
    finalMessage: M | null;
    exitReason: SessionExitReason;
    usage: ReturnType<AgentStateManager<T>["getTotalUsage"]>;
  }>;
}

/**
 * Configuration for a subagent session — wraps `SessionConfig` to automatically
 * handle `SubagentInput` fields (`previousThreadId`, `sandboxId`, `settings`).
 *
 * Omits fields that are derived from the input:
 * - `threadId` / `continueThread` — set from `input.previousThreadId`
 * - `sandboxId` — set from `input.sandboxId`
 * - `buildContextMessage` — replaced with an input-aware version
 *
 * @template T - Tool map type
 * @template TSettings - Settings type resolved from parent state
 * @template M - Model response type
 */
export interface SubagentSessionConfig<
  T extends ToolMap,
  TSettings extends Record<string, unknown> = Record<string, unknown>,
  M = unknown,
> extends Omit<
    SessionConfig<T, M>,
    "buildContextMessage" | "threadId" | "continueThread" | "sandboxId"
  > {
  /** The SubagentInput received from the parent agent */
  input: SubagentInput<TSettings>;
  /** Build context message with access to the full subagent input (prompt, context, settings) */
  buildContextMessage: (
    input: SubagentInput<TSettings>
  ) => MessageContent | Promise<MessageContent>;
}
