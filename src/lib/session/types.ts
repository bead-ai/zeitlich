import type { Duration } from "@temporalio/common";
import type {
  SessionExitReason,
  ToolResultConfig,
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
import type { VirtualFsOps } from "../virtual-fs/types";
import type { RunAgentActivity } from "../model/types";
import type { AgentStateManager, JsonSerializable } from "../state/types";
import type { ActivityInterfaceFor } from "@temporalio/workflow";
import type {
  ThreadInit,
  SandboxInit,
  SubagentSandboxShutdown,
} from "../lifecycle";

/**
 * Thread operations required by a session.
 * Consumers provide these — typically by wrapping Temporal activities.
 *
 * `TContent` is the SDK-native content type for human messages.
 * Each adapter supplies its own type (e.g. Anthropic ContentBlockParam[],
 * Google GenAI Part[], LangChain MessageContent). Defaults to `string`.
 */
export interface ThreadOps<TContent = string> {
  /** Initialize an empty thread */
  initializeThread(threadId: string, threadKey?: string): Promise<void>;
  /** Append a human message to the thread */
  appendHumanMessage(
    threadId: string,
    id: string,
    content: TContent,
    threadKey?: string
  ): Promise<void>;
  /** Append a tool result to the thread */
  appendToolResult(id: string, config: ToolResultConfig): Promise<void>;
  /** Append the model's response to the thread */
  appendAgentMessage(
    threadId: string,
    id: string,
    message: unknown,
    threadKey?: string
  ): Promise<void>;
  /** Append a system message to the thread */
  appendSystemMessage(
    threadId: string,
    id: string,
    content: unknown,
    threadKey?: string
  ): Promise<void>;
  /** Copy all messages from sourceThreadId into a new thread at targetThreadId */
  forkThread(
    sourceThreadId: string,
    targetThreadId: string,
    threadKey?: string
  ): Promise<void>;
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
export type PrefixedThreadOps<TPrefix extends string, TContent = string> = {
  [K in keyof ThreadOps<TContent> as `${TPrefix}${Capitalize<K & string>}`]: ThreadOps<TContent>[K];
};

/**
 * Configuration for a Zeitlich agent session.
 *
 * @typeParam T - Tool map
 * @typeParam M - SDK-native message type returned by the model invoker
 * @typeParam TContent - SDK-native content type for human messages (defaults to `string`)
 */
export interface SessionConfig<
  T extends ToolMap,
  M = unknown,
  TContent = string,
> {
  /** The name of the agent, should be unique within the workflows */
  agentName: string;
  /** Metadata for the session */
  metadata?: Record<string, unknown>;
  /** Whether to append the system prompt as message to the thread */
  appendSystemPrompt?: boolean;
  /** How many turns to run the session for */
  maxTurns?: number;
  /** Workflow-specific runAgent activity (with tools pre-bound) */
  runAgent: RunAgentActivity<M>;
  /** Thread operations (initialize, append messages, parse tool calls) */
  threadOps: ActivityInterfaceFor<ThreadOps<TContent>>;
  /** Tool router for processing tool calls (optional if agent has no tools) */
  tools?: T;
  /** Subagent configurations */
  subagents?: SubagentConfig[];
  /** Skills available to this agent (metadata + instructions, loaded before session creation) */
  skills?: Skill[];
  /** Session lifecycle hooks */
  hooks?: Hooks<T, ToolCallResultUnion<InferToolResults<T>>, TContent>;
  /** Whether to process tools in parallel */
  processToolsInParallel?: boolean;
  /**
   * Build context message content from agent-specific context.
   * Returns SDK-native content for the initial human message.
   */
  buildContextMessage: () => TContent | Promise<TContent>;
  /** How long to wait for input before cancelling the workflow */
  waitForInputTimeout?: Duration;

  // ---------------------------------------------------------------------------
  // Thread lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Thread initialization strategy (default: `{ mode: "new" }`).
   *
   * - `{ mode: "new" }` — start a fresh thread.
   * - `{ mode: "new", threadId: "..." }` — start a fresh thread with a specific ID.
   * - `{ mode: "continue", threadId: "..." }` — append to an existing thread in-place.
   * - `{ mode: "fork", threadId: "..." }` — fork an existing thread and continue in the copy.
   */
  thread?: ThreadInit;
  /**
   * Redis key suffix for thread storage. Defaults to `"messages"`.
   *
   * Controls the Redis key layout: `thread:${threadId}:${threadKey}`.
   * Use different keys to isolate storage across sessions sharing the
   * same adapter instance.
   */
  threadKey?: string;

  // ---------------------------------------------------------------------------
  // Sandbox lifecycle
  // ---------------------------------------------------------------------------

  /** Sandbox lifecycle operations (optional — omit for agents that don't need a sandbox) */
  sandboxOps?: SandboxOps;
  /**
   * Sandbox initialization strategy.
   *
   * - `{ mode: "new" }` — create a fresh sandbox.
   * - `{ mode: "continue", sandboxId: "..." }` — resume a paused sandbox (session owns it).
   * - `{ mode: "fork", sandboxId: "..." }` — fork from an existing sandbox.
   * - `{ mode: "inherit", sandboxId: "..." }` — use a parent's sandbox without ownership.
   *
   * When omitted and `sandboxOps` is provided, defaults to `{ mode: "new" }`.
   */
  sandbox?: SandboxInit;
  /**
   * What to do with the sandbox when this session exits.
   *
   * Defaults to `"destroy"` when omitted.
   * Has no effect when the sandbox is inherited (`sandbox.mode === "inherit"`).
   */
  sandboxShutdown?: SubagentSandboxShutdown;
  /**
   * Called as soon as the sandbox is created (or resumed/forked), before the
   * agent loop starts. Useful for signalling sandbox readiness to a parent.
   */
  onSandboxReady?: (sandboxId: string) => void;

  // ---------------------------------------------------------------------------
  // Virtual filesystem
  // ---------------------------------------------------------------------------

  virtualFsOps?: VirtualFsOps;

  /**
   * Virtual filesystem configuration (optional — independent of sandbox).
   *
   * When provided, the session resolves the file tree on start and merges
   * `fileTree`, `ctx`, and `workspaceBase` into `AgentState`.
   * Tool handlers wrapped with `withVirtualFs` can then read this state.
   *
   * Can be used alongside `sandboxOps` for agents that need both a real
   * sandbox (e.g. for execution) and a virtual filesystem.
   */
  virtualFs?: {
    ctx: unknown;
  };
}

export type SessionResult<
  M,
  TState extends JsonSerializable<TState>,
  HasSandbox extends boolean = boolean,
> = {
  threadId: string;
  finalMessage: M | null;
  exitReason: SessionExitReason;
  usage: ReturnType<AgentStateManager<TState>["getTotalUsage"]>;
} & (HasSandbox extends true
  ? { sandboxId: string }
  : { sandboxId?: undefined });

export interface ZeitlichSession<
  M = unknown,
  HasSandbox extends boolean = boolean,
> {
  runSession<T extends JsonSerializable<T>>(args: {
    stateManager: AgentStateManager<T>;
  }): Promise<SessionResult<M, T, HasSandbox>>;
}
