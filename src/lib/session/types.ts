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
import type { SubagentConfig } from "../subagent/types";
import type { Skill } from "../skills/types";
import type { SandboxOps } from "../sandbox/types";
import type { RunAgentActivity } from "../model/types";
import type { AgentStateManager, JsonSerializable } from "../state/types";
import type { ActivityInterfaceFor } from "@temporalio/workflow";

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
    id: string,
    content: string | MessageContent
  ): Promise<void>;
  /** Append a tool result to the thread */
  appendToolResult(id: string, config: ToolResultConfig): Promise<void>;
  /** Append a system message to the thread */
  appendSystemMessage(
    threadId: string,
    id: string,
    content: string
  ): Promise<void>;
  /** Copy all messages from sourceThreadId into a new thread at targetThreadId */
  forkThread(sourceThreadId: string, targetThreadId: string): Promise<void>;
}

/**
 * Composes an adapter prefix + workflow scope for activity naming.
 *
 * The adapter prefix stays first (camelCase); the workflow scope is
 * capitalised and appended. When `TScope` is empty the adapter prefix
 * is used as-is.
 *
 * @example
 * ```typescript
 * ScopedPrefix<"codingAgent", "googleGenAI"> // "googleGenAICodingAgent"
 * ScopedPrefix<"", "googleGenAI">            // "googleGenAI"
 * ```
 */
export type ScopedPrefix<
  TScope extends string,
  TAdapter extends string,
> = TScope extends "" ? TAdapter : `${TAdapter}${Capitalize<TScope>}`;

/**
 * Maps generic {@link ThreadOps} method names to adapter-prefixed names.
 *
 * @example
 * ```typescript
 * type GoogleOps = PrefixedThreadOps<"googleGenAI">;
 * // → { googleGenAIInitializeThread, googleGenAIAppendHumanMessage, … }
 * ```
 */
export type PrefixedThreadOps<TPrefix extends string> = {
  [K in keyof ThreadOps as `${TPrefix}${Capitalize<K & string>}`]: ThreadOps[K];
};

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
  threadOps: ActivityInterfaceFor<ThreadOps>;
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
  sandboxOps?: SandboxOps;
  /**
   * Pre-existing sandbox ID to reuse (e.g. inherited from a parent agent).
   * When set, the session skips `createSandbox` and will not destroy the
   * sandbox on exit (the owner is responsible for cleanup).
   */
  sandboxId?: string;
  /**
   * The child's own previously-paused sandbox ID to fork from at the start of
   * a continued session. Takes precedence over `sandboxId` for the fork path.
   * Populated automatically by the subagent handler when `allowSandboxContinuation` is set.
   */
  previousSandboxId?: string;
  /**
   * Sandbox lifecycle policy applied when this session exits.
   *
   * Defaults to `{ kind: "destroy" }` when omitted.
   *
   * Has no effect if the session does not own the sandbox (i.e. `sandboxId`
   * was provided by the caller).
   */
  sandboxOnExit?: "destroy" | "pause" | "pause-until-parent-close";
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
