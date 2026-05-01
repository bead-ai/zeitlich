import type { Duration } from "@temporalio/common";
import type { SessionExitReason, ToolResultConfig } from "../types";
import type {
  ToolMap,
  ToolCallResultUnion,
  InferToolResults,
} from "../tool-router/types";
import type { Hooks } from "../hooks/types";
import type { SubagentConfig } from "../subagent/types";
import type { Skill } from "../skills/types";
import type {
  SandboxCapability,
  SandboxCreateOptions,
  SandboxOps,
  SandboxSnapshot,
} from "../sandbox/types";
import type { VirtualFsOps } from "../virtual-fs/types";
import type { RunAgentActivity } from "../model/types";
import type {
  AgentStateManager,
  JsonSerializable,
  PersistedThreadState,
} from "../state/types";
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
  /**
   * Copy all messages AND the persisted state slice (tasks + custom
   * state) from `sourceThreadId` into a new thread at `targetThreadId`.
   * Adapters that have `onForkPrepareThread` and/or `onForkTransform`
   * hooks configured apply them once to the new thread's messages
   * before returning.
   */
  forkThread(
    sourceThreadId: string,
    targetThreadId: string,
    threadKey?: string
  ): Promise<void>;
  /**
   * Truncate the thread starting at `messageId`: that message and every
   * message after it are removed. If `messageId` is not present the call
   * is a no-op.
   *
   * The `runAgent` activity invokes this on entry with the pre-generated
   * `assistantMessageId`. On the happy path the id is not yet in the
   * thread and the call is a no-op. On a rewind retry (same assistant
   * id reused) or a Temporal workflow reset-to-this-activity the id is
   * present, so the bad assistant + any tool results it produced are
   * wiped and the call is then replayable.
   */
  truncateThread(
    threadId: string,
    messageId: string,
    threadKey?: string
  ): Promise<void>;
  /**
   * Load the persisted state slice (tasks + custom state) associated with
   * the thread, or `null` if none has been saved yet. Called on session
   * start for `continue`/`fork` threads to rehydrate {@link AgentStateManager}.
   */
  loadThreadState(
    threadId: string,
    threadKey?: string
  ): Promise<PersistedThreadState | null>;
  /**
   * Overwrite the persisted state slice for the thread. Called once from
   * the session's `finally` block on every exit path so that "finish,
   * store, continue later" works regardless of exit reason.
   */
  saveThreadState(
    threadId: string,
    state: PersistedThreadState,
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

// ============================================================================
// Session sandbox-lifecycle decision table (SSOT)
//
// `createSession` (`src/lib/session/session.ts`) dispatches gated
// sandbox methods based on `(sandbox.mode, sandboxShutdown)`. When a
// caller omits either field, the session uses the documented defaults
// (`sandbox: { mode: "new" }` and `sandboxShutdown: "destroy"`),
// which trigger only base ops (`createSandbox` / `destroySandbox`).
//
// Two surfaces have to agree on what gated methods may fire for a
// given config:
//
//   1. The runtime — what the session dispatches per `(mode,
//      shutdown)` pair.
//   2. The type level — what caps `sandboxOps` has to advertise.
//
// `SessionRequiredCaps<TInit, TShutdown>` is the SSOT for the type
// level. `resolveSessionLifecycle(init, shutdown)` (in `session.ts`,
// re-exported below) is the runtime mirror. Adding a new branch to
// `session.ts` requires extending **both**; the
// `(sandbox.mode × sandboxShutdown × adapter)` matrix in
// `src/lib/sandbox/capability-types.test.ts` enforces agreement.
// ============================================================================

/**
 * Caps the session's sandbox-init dispatch may invoke for a given
 * `(mode, shutdown)`. Mirror of `src/lib/session/session.ts:241-313`.
 *
 * The conditional branches are written non-distributively (each cap
 * checked against the input `M` / `S` rather than over a union) so
 * that the *omitted* case (defaults: M = "new", S = "destroy") flows
 * through to `never`, not to "I don't know, assume everything."
 */
type _SessionInitCaps<M, S> =
  | (M extends "fork" ? "fork" : never)
  | (M extends "from-snapshot" ? "restore" : never)
  | (M extends "continue"
      ? S extends "pause-until-parent-close"
        ? "resume"
        : never
      : never);

/**
 * Caps the session's exit dispatch may invoke. `"inherit"` mode keeps
 * `sandboxOwned = false` so exit-shutdown caps NEVER fire — mirror of
 * `src/lib/session/session.ts:598-615`.
 */
type _SessionExitCaps<M, S> = M extends "inherit"
  ? never
  :
      | (S extends "snapshot" ? "snapshot" : never)
      | (S extends "pause" | "pause-until-parent-close" ? "pause" : never);

/**
 * Cap captured on entry for `mode: "new"` + `shutdown: "snapshot"` (the
 * seeding-base-snapshot path). Mirror of
 * `src/lib/session/session.ts:316-317`.
 */
type _SessionSeedCaps<M, S> = M extends "new"
  ? S extends "snapshot"
    ? "snapshot"
    : never
  : never;

/**
 * Resolves an omitted `sandbox` field to the runtime default
 * `{ mode: "new" }`, and an omitted `sandboxShutdown` field to the
 * runtime default `"destroy"`. The two `_Resolve…` helpers are the
 * sole bridge between "user didn't set the field" and the SSOT below
 * — keeping the defaults out of the conditional table itself.
 */
type _ResolveInit<TInit> = [TInit] extends [undefined]
  ? { mode: "new" }
  : Exclude<TInit, undefined> extends infer Defined
    ? // If the user passed `SandboxInit | undefined` (the wide default),
      // collapse `undefined` to the runtime default.
      undefined extends TInit
      ? Defined | { mode: "new" }
      : Defined
    : never;

type _ResolveShutdown<TShutdown> = [TShutdown] extends [undefined]
  ? "destroy"
  : Exclude<TShutdown, undefined> extends infer Defined
    ? undefined extends TShutdown
      ? Defined | "destroy"
      : Defined
    : never;

/**
 * Sandbox capabilities a session actually invokes on its
 * `sandboxOps`, derived from the literal types of the surrounding
 * `sandbox` and `sandboxShutdown` fields.
 *
 * `TInit` / `TShutdown` default to `undefined` so an un-parameterised
 * `SessionRequiredCaps` resolves to the caps the runtime *defaults*
 * (`{ mode: "new" }` + `"destroy"`) actually require — i.e.
 * `never`. This lets a narrow adapter (e.g. `proxyDaytonaSandboxOps`)
 * satisfy `sandboxOps?: SandboxOps<…, SessionRequiredCaps<…>>` when
 * the caller doesn't pin literals, matching what's runtime-safe.
 *
 * Pin literals via `as const` or by ascribing `SessionConfig<…, TInit,
 * TShutdown>` to tighten the requirement on a per-call basis.
 */
export type SessionRequiredCaps<
  TInit extends SandboxInit | undefined = undefined,
  TShutdown extends SubagentSandboxShutdown | undefined = undefined,
> = _ResolveInit<TInit> extends infer M
  ? _ResolveShutdown<TShutdown> extends infer S
    ? M extends { mode: infer Mode }
      ? S extends SubagentSandboxShutdown
        ?
            | _SessionInitCaps<Mode, S>
            | _SessionExitCaps<Mode, S>
            | _SessionSeedCaps<Mode, S>
        : never
      : never
    : never
  : never;

/**
 * Runtime mirror of `SessionRequiredCaps`. Returns the names of the
 * gated `sandboxOps` methods the session will invoke for a given
 * `(sandboxInit, sandboxShutdown)` pair (after resolving documented
 * defaults). Mirror of the dispatch in
 * `src/lib/session/session.ts:241-313` and `:598-615`.
 *
 * Both surfaces consult this same table — the `(mode × shutdown ×
 * adapter)` matrix in `src/lib/sandbox/capability-types.test.ts`
 * enforces agreement.
 */
export function resolveSessionLifecycle(
  init: SandboxInit | undefined,
  shutdown: SubagentSandboxShutdown | undefined
): { mode: SandboxInit["mode"]; shutdown: SubagentSandboxShutdown } {
  const resolvedInit: SandboxInit = init ?? { mode: "new" };
  const resolvedShutdown: SubagentSandboxShutdown = shutdown ?? "destroy";
  return {
    mode: resolvedInit.mode,
    shutdown: resolvedShutdown,
  };
}

/**
 * Configuration for a Zeitlich agent session.
 *
 * @typeParam T - Tool map
 * @typeParam M - SDK-native message type returned by the model invoker
 * @typeParam TContent - SDK-native content type for human messages (defaults to `string`)
 * @typeParam TInit - Literal type of `sandbox` (a {@link SandboxInit}
 *   variant or `undefined`). Defaults to the wide union; pin it via
 *   `as const` on the call site to narrow the cap requirement on
 *   `sandboxOps`.
 * @typeParam TShutdown - Literal type of `sandboxShutdown`. Defaults
 *   to the wide union; pin it via `as const` on the call site to
 *   narrow the cap requirement on `sandboxOps`.
 */
export interface SessionConfig<
  T extends ToolMap,
  M = unknown,
  TContent = string,
  TInit extends SandboxInit | undefined = SandboxInit | undefined,
  TShutdown extends
    | SubagentSandboxShutdown
    | undefined = SubagentSandboxShutdown | undefined,
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

  /**
   * Sandbox lifecycle operations (optional — omit for agents that don't
   * need a sandbox).
   *
   * The `TCaps` argument is derived from {@link SessionRequiredCaps}
   * over the literal types of the surrounding `sandbox` and
   * `sandboxShutdown` fields. With the default wide
   * `TInit` / `TShutdown`, this resolves to the full
   * {@link SandboxCapability} union (current behaviour). When the
   * caller pins those literals via `as const`, the cap requirement
   * tightens so a narrow adapter (e.g. Daytona's
   * `SandboxOps<…, never>`) can satisfy combinations that don't need
   * a gated method.
   */
  sandboxOps?: SandboxOps<
    SandboxCreateOptions,
    unknown,
    SessionRequiredCaps<TInit, TShutdown> & SandboxCapability
  >;
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
  sandbox?: TInit;
  /**
   * What to do with the sandbox when this session exits.
   *
   * Defaults to `"destroy"` when omitted.
   * Has no effect when the sandbox is inherited (`sandbox.mode === "inherit"`).
   */
  sandboxShutdown?: TShutdown;
  /**
   * Called as soon as the sandbox is created (or resumed/forked), before the
   * agent loop starts. Useful for signalling sandbox readiness to a parent.
   *
   * `baseSnapshot` is only populated when the sandbox was freshly created
   * this run and `sandboxShutdown === "snapshot"` — i.e. when the session
   * captured a seed snapshot intended for reuse.
   */
  onSandboxReady?: (args: {
    sandboxId: string;
    baseSnapshot?: SandboxSnapshot;
  }) => void;
  /**
   * Called right before `runSession` returns, with the session's sandbox
   * outputs. Useful for callers (e.g. `defineSubagentWorkflow`) that want to
   * forward these fields to their own return value without requiring user
   * code to manually thread them through.
   */
  onSessionExit?: (result: {
    threadId: string;
    sandboxId?: string;
    snapshot?: SandboxSnapshot;
  }) => void;

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
  /**
   * Snapshot captured on exit when `sandboxShutdown === "snapshot"`.
   */
  snapshot?: SandboxSnapshot;
  /**
   * Snapshot captured immediately after sandbox seeding (before the agent
   * loop starts) when `sandbox.mode === "new"` and
   * `sandboxShutdown === "snapshot"`. Intended as a reusable "base" for new
   * threads that want to skip re-seeding.
   */
  baseSnapshot?: SandboxSnapshot;
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
