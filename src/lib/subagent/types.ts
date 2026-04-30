import type { z } from "zod";
import type { ChildWorkflowOptions } from "@temporalio/workflow";
import type { JsonValue } from "../state/types";
import type {
  ToolHandlerResponse,
  PreToolUseHookResult,
  PostToolUseFailureHookResult,
} from "../tool-router/types";
import type {
  ThreadInit,
  SandboxInit,
  SubagentSandboxShutdown,
} from "../lifecycle";
import type {
  SandboxCapability,
  SandboxCreateOptions,
  SandboxOps,
  SandboxSnapshot,
} from "../sandbox/types";

/**
 * Subset of {@link ChildWorkflowOptions} that callers may override when a
 * subagent is invoked. `workflowId`, `taskQueue`, and `args` are managed by
 * the subagent handler itself and therefore cannot be set here.
 *
 * Configuring `workflowRunTimeout` (or `workflowExecutionTimeout`) is strongly
 * recommended: it is the only reliable way to guarantee that a child workflow
 * which fails during initialization or repeatedly fails workflow tasks will
 * eventually be terminated, allowing the parent's `Subagent` tool call to fail
 * deterministically instead of hanging forever waiting for a result.
 */
export type SubagentChildWorkflowOptions = Omit<
  ChildWorkflowOptions,
  "workflowId" | "taskQueue" | "args"
>;

/** ToolHandlerResponse with threadId required (subagents must always surface their thread) */
export type SubagentHandlerResponse<
  TResult = null,
  TToolResponse = JsonValue,
> = ToolHandlerResponse<TResult, TToolResponse>;

/**
 * Raw workflow input fields passed from parent to child workflow.
 * `defineSubagentWorkflow` maps this into `SubagentSessionInput`.
 */
export interface SubagentWorkflowInput {
  /** Thread initialization strategy forwarded from the parent */
  thread?: ThreadInit;
  /** Sandbox initialization strategy forwarded from the parent */
  sandbox?: SandboxInit;
  /** Sandbox shutdown override from the parent (takes precedence over workflow default) */
  sandboxShutdown?: SubagentSandboxShutdown;
}

export type SubagentWorkflow<TResult extends z.ZodType = z.ZodType> = (
  prompt: string,
  workflowInput: SubagentWorkflowInput,
  context?: Record<string, unknown>
) => Promise<SubagentHandlerResponse<z.infer<TResult> | null>>;

/**
 * A subagent workflow with embedded metadata (name, description, resultSchema).
 * Created by `defineSubagentWorkflow` — pass directly to `defineSubagent`.
 */
export type SubagentDefinition<
  TResult extends z.ZodType = z.ZodType,
  TContext extends Record<string, unknown> = Record<string, unknown>,
> = ((
  prompt: string,
  workflowInput: SubagentWorkflowInput,
  context?: TContext
) => Promise<SubagentHandlerResponse<z.infer<TResult> | null>>) & {
  readonly agentName: string;
  readonly description: string;
  readonly resultSchema?: TResult;
};

/** Context value or factory — resolved at invocation time when a function is provided */
export type SubagentContext =
  | Record<string, unknown>
  | (() => Record<string, unknown>);

/** Infer the z.infer'd result type from a SubagentConfig, or null if no schema */
export type InferSubagentResult<T extends SubagentConfig> =
  T extends SubagentConfig<infer S> ? z.infer<S> : null;

// ============================================================================
// Subagent sandbox-lifecycle decision table (SSOT)
//
// `createSubagentHandler` (`src/lib/subagent/handler.ts`) auto-injects
// `sandboxShutdown` for some `(source, continuation, init, shutdown)`
// combinations (`mustSurvive` + `alreadySurvives` rules). The child
// session then dispatches gated sandbox methods based on the resolved
// `(sandbox.mode, sandboxShutdown)` pair (`src/lib/session/session.ts`).
//
// Two surfaces have to agree on what gated methods may fire for a given
// config:
//
//   1. The runtime — what the parent injects + what the child session
//      dispatches.
//   2. The type level — what caps the proxy field has to advertise.
//
// `SubagentRequiredCaps<C>` is the SSOT for the type level.
// `resolveSubagentLifecycle(cfg)` (in `handler.ts`) is the SSOT for the
// runtime; it returns the specific `(mode, shutdown)` to inject and is
// the only place the auto-injection rules live. Adding a new runtime
// branch in `handler.ts` requires extending **both** — the matrix in
// `src/lib/sandbox/capability-types.test.ts` then locks the agreement.
//
// `Continuation`-only / `Shutdown`-only sub-types live below as helpers
// `_ChildModeCaps` / `_ChildShutdownCaps` so each branch reads cleanly.
// ============================================================================

/** Shutdown classes that the runtime treats equivalently for cap purposes. */
type _ShutdownPauseLike = "pause" | "pause-until-parent-close";
type _ShutdownKeepLike = "keep" | "keep-until-parent-close";

/**
 * Caps the child session's sandbox-init dispatch invokes for a given
 * `(mode, shutdown)`. Mirror of `src/lib/session/session.ts:230-314`.
 */
type _ChildModeCaps<Mode, Shutdown> =
  // mode "fork" → forkSandbox
  | (Mode extends "fork" ? "fork" : never)
  // mode "from-snapshot" → restoreSandbox
  | (Mode extends "from-snapshot" ? "restore" : never)
  // mode "continue" + shutdown "pause-until-parent-close" → resumeSandbox
  | (Mode extends "continue"
      ? Shutdown extends "pause-until-parent-close"
        ? "resume"
        : never
      : never);

/**
 * Caps the child session's exit dispatch invokes for a given `shutdown`.
 * Only fires when `sandboxOwned` is true (mode != "inherit"). Mirror of
 * `src/lib/session/session.ts:598-615`.
 */
type _ChildShutdownCaps<Mode, Shutdown> =
  // mode="inherit" → sandboxOwned=false → no exit-shutdown caps fire
  Mode extends "inherit"
    ? never
    :
        | (Shutdown extends _ShutdownPauseLike ? "pause" : never)
        | (Shutdown extends "snapshot" ? "snapshot" : never);

/**
 * Caps captured on entry for `mode: "new"` + `shutdown: "snapshot"`
 * (the seeding-base-snapshot path). Mirror of
 * `src/lib/session/session.ts:316-317`.
 */
type _ChildSeedCaps<Mode, Shutdown> = Mode extends "new"
  ? Shutdown extends "snapshot"
    ? "snapshot"
    : never
  : never;

/**
 * Total caps a single child-session invocation calls for the specific
 * `(mode, shutdown)` pair the parent passes. The proxy field's required
 * cap union is the union of this across every `(mode, shutdown)` the
 * runtime might inject for the given config.
 */
type _ChildSessionCaps<Mode, Shutdown> =
  | _ChildModeCaps<Mode, Shutdown>
  | _ChildShutdownCaps<Mode, Shutdown>
  | _ChildSeedCaps<Mode, Shutdown>;

/**
 * Resolves the user's `shutdown` value through the auto-injection rules
 * for `(source: "own", continuation: "continue")`. Mirror of
 * `src/lib/subagent/handler.ts:373-389`:
 *
 *   - `pause` / `pause-until-parent-close` / `keep` / `keep-until-parent-close`
 *     → propagate (`alreadySurvives = true`).
 *   - everything else (undefined, "destroy", "snapshot") → injected
 *     `"pause"` (subsequent calls) or `"pause-until-parent-close"`
 *     (creator first call). Type-level: union both.
 */
type _ContinueShutdown<S> = S extends _ShutdownPauseLike | _ShutdownKeepLike
  ? S
  : "pause" | "pause-until-parent-close";

/**
 * Resolves the user's `shutdown` value through the auto-injection rules
 * for `(source: "own", continuation: "fork", init: "once")`. Same shape
 * as `_ContinueShutdown` because both are `mustSurvive` paths.
 */
type _ForkOnceShutdown<S> = _ContinueShutdown<S>;

/**
 * Modes the child session may be invoked under for `(source: "own",
 * continuation: "continue")`. First call has no `baseSandboxId` (mode
 * "new"); subsequent calls reuse it (mode "continue"). The type takes
 * the union — the matrix can't tell first vs. subsequent statically.
 */
type _OwnContinueModes = "new" | "continue";

/**
 * Modes the child session may be invoked under for `(source: "own",
 * continuation: "fork")`. Same first-vs-subsequent shape as continue.
 */
type _OwnForkModes = "new" | "fork";

/**
 * Modes the child session may be invoked under for `(source: "own",
 * continuation: "snapshot")`. First call (no base snapshot yet) uses
 * "new"; subsequent calls (or `init: "once"` after the first creator
 * publishes a base) use "from-snapshot".
 */
type _OwnSnapshotModes = "new" | "from-snapshot";

/**
 * Caps required on a subagent's `proxy` for the parent's own gated
 * calls. The parent only ever calls `destroySandbox` (base) and
 * `deleteSandboxSnapshot` (`continuation: "snapshot"` cleanup).
 */
type _ParentLocalCaps<C> = C extends { continuation: "snapshot" }
  ? "snapshot"
  : never;

/**
 * **SSOT type.** The full cap union a subagent's `proxy` must expose,
 * derived from `(source, continuation, init, shutdown)`.
 *
 * The shape mirrors the rows of the runtime decision table in
 * `resolveSubagentLifecycle` (`src/lib/subagent/handler.ts`): each
 * branch here corresponds to exactly one runtime branch, and adding a
 * new runtime branch requires adding a matching branch here. The
 * `(adapter × continuation × shutdown × init × source)` matrix in
 * `src/lib/sandbox/capability-types.test.ts` enforces agreement.
 */
export type SubagentRequiredCaps<C> = C extends "none"
  ? never
  : C extends { source: "inherit"; continuation: "continue" }
    ? // mode="inherit", sandboxOwned=false → no gated calls regardless
      // of shutdown value.
      never
    : C extends { source: "inherit"; continuation: "fork" }
      ? // mode="fork" + user shutdown propagates verbatim (no
        // auto-injection on the inherit path).
        | "fork"
            | _ChildSessionCaps<
                "fork",
                C extends { shutdown: infer S } ? S : "destroy"
              >
            | _ParentLocalCaps<C>
      : C extends { source: "own"; continuation: "snapshot" }
        ? // override = "snapshot" always; modes vary across calls.
          | _ChildSessionCaps<_OwnSnapshotModes, "snapshot">
              | _ParentLocalCaps<C>
        : C extends { source: "own"; continuation: "continue" }
          ? // mustSurvive=true; injection rules apply.
            | _ChildSessionCaps<
                  _OwnContinueModes,
                  _ContinueShutdown<
                    C extends { shutdown: infer S } ? S : undefined
                  >
                >
              | _ParentLocalCaps<C>
          : C extends {
                source: "own";
                continuation: "fork";
                init?: infer I;
              }
            ? // mustSurvive iff init=once.
              | "fork"
                  | _ChildSessionCaps<
                      _OwnForkModes,
                      I extends "once"
                        ? _ForkOnceShutdown<
                            C extends { shutdown: infer S } ? S : undefined
                          >
                        : C extends { shutdown: infer S }
                          ? S extends undefined
                            ? "destroy"
                            : S
                          : "destroy"
                    >
                  | _ParentLocalCaps<C>
            : never;

/**
 * Backwards-compatible alias retained for external callers that imported
 * the old name. Resolves through the SSOT against a synthetic
 * `{ source: "own", continuation: C }` config.
 *
 * @deprecated Use `SubagentRequiredCaps<C>` against the full subagent
 * sandbox config — `continuation` alone misses `shutdown` and `init`,
 * which is why the previous mapping under-rejected `fork`+`pause` and
 * `continue`+auto-injected pause.
 */
export type SubagentContinuationCaps<C extends SubagentContinuation> =
  C extends "snapshot"
    ? "snapshot" | "restore"
    : C extends "fork"
      ? "fork"
      : never;

// ============================================================================
// Subagent lifecycle SSOT — runtime mirror of `SubagentRequiredCaps`
//
// `resolveSubagentLifecycle` is the runtime side of the same table
// `SubagentRequiredCaps` reads at the type level. Whenever
// `createSubagentHandler` (`src/lib/subagent/handler.ts`) needs to
// decide which `(sandbox.mode, sandboxShutdown)` to inject for the
// child, it calls this function — so the auto-injection rules
// (`mustSurvive`, `alreadySurvives`, snapshot override) live in
// **one** place. Adding a new branch to the runtime means changing
// this function AND the matching branch in `SubagentRequiredCaps`;
// the `(adapter × continuation × shutdown × init × source)` matrix
// in `src/lib/sandbox/capability-types.test.ts` enforces the agree.
// ============================================================================

/**
 * Resolved sandbox config after normalising defaults. The handler
 * passes one of these into `resolveSubagentLifecycle`.
 */
export interface ResolvedSubagentSandboxConfig {
  source: "none" | "inherit" | "own";
  init: "per-call" | "once";
  continuation: "continue" | "fork" | "snapshot";
  shutdown?: SubagentSandboxShutdown;
}

/**
 * Output of `resolveSubagentLifecycle`. The handler reads
 * `shutdownOverride` to decide what to forward to the child workflow,
 * and `mustSurvive` / `isLazyCreator` to drive the in-handler
 * bookkeeping (pendingDestroys, persistentSandboxes, etc.).
 */
export interface ResolvedSubagentLifecycle {
  /**
   * Sandbox shutdown the parent forwards to the child workflow. May
   * be auto-injected (`"pause"` / `"pause-until-parent-close"` /
   * `"snapshot"`) when the user's literal would not survive long
   * enough for the parent's continuation strategy.
   */
  shutdownOverride: SubagentSandboxShutdown | undefined;
  /**
   * Whether the parent must keep the sandbox alive past the child
   * session's exit. Drives the `pendingDestroys` map population.
   */
  mustSurvive: boolean;
}

/**
 * Returns true iff the user's `shutdown` already keeps the sandbox
 * alive (so the handler doesn't need to auto-inject one).
 *
 * Mirror of the type-level `_ShutdownPauseLike` / `_ShutdownKeepLike`
 * checks above.
 */
function isSurvivalShutdown(s: SubagentSandboxShutdown | undefined): boolean {
  return (
    s === "pause" ||
    s === "pause-until-parent-close" ||
    s === "keep" ||
    s === "keep-until-parent-close"
  );
}

/**
 * The single runtime decision-table consumer. Returns the shutdown the
 * parent should forward to the child plus survival metadata.
 *
 * Branches must agree, one-for-one, with `SubagentRequiredCaps<C>` in
 * this file. The matrix in `capability-types.test.ts` covers each
 * branch.
 */
export function resolveSubagentLifecycle(
  cfg: ResolvedSubagentSandboxConfig,
  isLazyCreator: boolean
): ResolvedSubagentLifecycle {
  // none / inherit: no auto-injection. Handler still calls
  // destroySandbox on child exit when mode=inherit, but
  // `sandboxOwned` stays false in the child session so no exit-
  // shutdown caps fire. Parent's pendingDestroys is driven entirely
  // by the user's shutdown propagating verbatim.
  if (cfg.source !== "own") {
    return {
      shutdownOverride: cfg.shutdown,
      mustSurvive: false,
    };
  }

  // own + snapshot: handler always overrides shutdown to "snapshot".
  // No survival flag (snapshots are cleaned up via deleteSandboxSnapshot,
  // not via pendingDestroys).
  if (cfg.continuation === "snapshot") {
    return {
      shutdownOverride: "snapshot",
      mustSurvive: false,
    };
  }

  // own + (continue | fork): mustSurvive iff isLazyCreator OR
  // continuation === "continue" OR (init === "once" + fork).
  const isLazy = cfg.init === "once";
  const mustSurvive =
    isLazyCreator ||
    cfg.continuation === "continue" ||
    (isLazy && cfg.continuation === "fork");

  if (!mustSurvive) {
    return { shutdownOverride: cfg.shutdown, mustSurvive: false };
  }

  // mustSurvive: auto-inject only if the user's shutdown doesn't
  // already survive.
  if (isSurvivalShutdown(cfg.shutdown)) {
    return { shutdownOverride: cfg.shutdown, mustSurvive };
  }
  return {
    shutdownOverride: isLazyCreator ? "pause-until-parent-close" : "pause",
    mustSurvive,
  };
}

/** Continuation values supported when `source` is `"inherit"`. */
type InheritContinuation = "continue" | "fork";
/** Continuation values supported when `source` is `"own"`. */
type OwnContinuation = "continue" | "fork" | "snapshot";
/** Union of every continuation value across both sources. */
type SubagentContinuation = InheritContinuation | OwnContinuation;

/**
 * Caps required on a subagent's `proxy` when `source: "inherit"`,
 * threaded through the SSOT.
 *
 * The `inherit` source has no `init` field, and the `shutdown` field
 * is the user's literal (or `"destroy"` if omitted). We don't have a
 * way to detect "omitted" in the field type itself, so this row
 * resolves the user's `S | undefined` directly — `undefined` is treated
 * as `"destroy"` to match the runtime default in
 * `src/lib/subagent/handler.ts:469`.
 */
type _InheritCaps<C extends InheritContinuation, S> = SubagentRequiredCaps<{
  source: "inherit";
  continuation: C;
  shutdown: S extends undefined ? "destroy" : S;
}>;

/**
 * Variants for `source: "inherit"`. Continuation × shutdown-presence ×
 * shutdown-literal all distribute, with omitted vs. specified
 * `shutdown` encoded as separate variants — for the same reason
 * `OwnVariant` does (forbid TS from matching a permissive cell when
 * the user omits the field).
 */
type InheritVariant<TOptions extends SandboxCreateOptions> =
  InheritContinuation extends infer C
    ? C extends InheritContinuation
      ? (
          | { _s: undefined; shutdown?: never }
          | (SubagentSandboxShutdown extends infer SL
              ? SL extends SubagentSandboxShutdown
                ? { _s: SL; shutdown: SL }
                : never
              : never)
        ) extends infer S
        ? S extends {
            _s: SubagentSandboxShutdown | undefined;
            shutdown?: SubagentSandboxShutdown;
          }
          ? Omit<S, "_s"> & {
              source: "inherit";
              continuation: C;
              proxy: (
                scope: string
              ) => SandboxOps<
                TOptions,
                unknown,
                _InheritCaps<C, S["_s"]> & SandboxCapability
              >;
            }
          : never
        : never
      : never
    : never;

type _OwnCaps<
  C extends OwnContinuation,
  I extends "per-call" | "once" | undefined,
  S,
> = SubagentRequiredCaps<{
  source: "own";
  continuation: C;
  init: I extends undefined ? "per-call" : I;
  shutdown: S;
}>;

/**
 * Variants for `source: "own"`. Continuation × init-presence × shutdown-
 * presence × shutdown-literal all distribute, so each cell gets its
 * own variant with a precisely-typed `proxy`.
 *
 * Critical: omitted vs. specified `init` / `shutdown` are encoded as
 * *separate* variants. The omitted variant uses `init?: never` /
 * `shutdown?: never` so the field is forbidden when the user doesn't
 * write one — without this, TS would infer `field?: undefined` and
 * happily match an unrelated permissive variant whose caps don't
 * cover the auto-injection.
 */
type OwnVariant<TOptions extends SandboxCreateOptions> =
  OwnContinuation extends infer C
    ? C extends OwnContinuation
      ? // Init: omitted (never present) | "per-call" required | "once" required.
        (
          | { _i: undefined; init?: never }
          | { _i: "per-call"; init: "per-call" }
          | { _i: "once"; init: "once" }
        ) extends infer I
        ? I extends {
            _i: "per-call" | "once" | undefined;
            init?: "per-call" | "once";
          }
          ? // Shutdown: omitted | one of the literal values required.
            (
              | { _s: undefined; shutdown?: never }
              | (SubagentSandboxShutdown extends infer SL
                  ? SL extends SubagentSandboxShutdown
                    ? { _s: SL; shutdown: SL }
                    : never
                  : never)
            ) extends infer S
            ? S extends {
                _s: SubagentSandboxShutdown | undefined;
                shutdown?: SubagentSandboxShutdown;
              }
              ? Omit<I, "_i"> &
                  Omit<S, "_s"> & {
                    source: "own";
                    continuation: C;
                    proxy: (
                      scope: string
                    ) => SandboxOps<
                      TOptions,
                      unknown,
                      _OwnCaps<C, I["_i"], S["_s"]> & SandboxCapability
                    >;
                  }
              : never
            : never
          : never
        : never
      : never
    : never;

/**
 * Sandbox configuration for a subagent.
 *
 * - `"none"` — no sandbox (default).
 * - `{ source: "inherit", continuation, proxy }` — reuse the parent's sandbox.
 *   `continuation: "continue"` shares the parent sandbox directly;
 *   `continuation: "fork"` forks from the parent on every call.
 * - `{ source: "own", init?, continuation, proxy }` — the child gets its own
 *   sandbox. `init: "per-call"` (default) creates fresh each call (thread
 *   continuation uses the previous sandbox). `init: "once"` creates on the
 *   first call and stores it for all subsequent calls.
 *
 * `proxy` is a factory that returns workflow-safe sandbox ops matching the
 * subagent's own activities. Called once inside `createSubagentHandler` with
 * `scope = agentName`, so the returned proxy resolves to the same activity
 * prefix the child session uses. The parent uses it to destroy lingering
 * sandboxes and delete stored snapshots at shutdown.
 *
 * The `proxy` field's required `TCaps` is derived from
 * {@link SubagentRequiredCaps} — the SSOT that mirrors
 * `resolveSubagentLifecycle` in the handler. It folds in `shutdown` and
 * `init` (including the handler's auto-injected `"pause"` /
 * `"pause-until-parent-close"` overrides), so any `(adapter, source,
 * continuation, init, shutdown)` cell that can't execute at runtime
 * fails to typecheck at the `defineSubagent` site.
 *
 * `TOptions` defaults to {@link SandboxCreateOptions} so the wide,
 * un-parameterised `SubagentSandboxConfig` keeps working for callers
 * that don't need adapter-specific options.
 */
export type SubagentSandboxConfig<
  TOptions extends SandboxCreateOptions = SandboxCreateOptions,
> = "none" | InheritVariant<TOptions> | OwnVariant<TOptions>;

/**
 * Configuration for a subagent that can be spawned by the parent workflow.
 *
 * @template TResult - Zod schema type for validating the child workflow's result
 */
export interface SubagentConfig<TResult extends z.ZodType = z.ZodType> {
  /** Identifier used in Task tool's subagent parameter */
  agentName: string;
  /** Description shown to the parent agent explaining what this subagent does */
  description: string;
  /** Whether this subagent is available (default: true). Disabled subagents are excluded from the Subagent tool. */
  enabled?: boolean | (() => boolean);
  /** Temporal workflow function or type name (used with executeChild) */
  workflow: SubagentWorkflow<TResult>;
  /** Optional task queue - defaults to parent's queue if not specified */
  taskQueue?: string;
  /**
   * Optional child workflow options forwarded to `executeChild` when the
   * subagent is spawned. Use this to configure timeouts, retry policies, or
   * parent-close behavior for the child workflow.
   *
   * **Recommended:** configure a `workflowRunTimeout` (or
   * `workflowExecutionTimeout`) so that a child workflow that fails to
   * initialize — or repeatedly fails workflow tasks without ever reaching a
   * terminal state — is eventually terminated by the Temporal server. Without
   * such a timeout, the parent's `Subagent` tool call can hang indefinitely
   * waiting for the child to finish. When Temporal terminates the child, the
   * tool call fails with a structured `ChildWorkflowFailure` that the router's
   * failure hooks can handle just like any other tool error.
   *
   * `workflowId`, `taskQueue`, and `args` are managed by the subagent handler
   * and cannot be overridden here.
   */
  workflowOptions?: SubagentChildWorkflowOptions;
  /** Optional Zod schema to validate the child workflow's result. If omitted, result is passed through as-is. */
  resultSchema?: TResult;
  /** Optional context passed to the subagent — a static object or a function evaluated at invocation time */
  context?: SubagentContext;
  /** Per-subagent lifecycle hooks */
  hooks?: SubagentHooks;
  /**
   * Thread mode for this subagent.
   *
   * - `"new"` (default) — always start a fresh thread.
   * - `"fork"` — the parent can pass a `threadId`; messages are copied into
   *   a new thread and the subagent continues there.
   * - `"continue"` — the parent can pass a `threadId`; the subagent appends
   *   directly to the existing thread in-place.
   */
  thread?: "new" | "fork" | "continue";
  /**
   * Sandbox strategy for this subagent.
   *
   * @see {@link SubagentSandboxConfig}
   *
   * @example
   * ```ts
   * import { proxyDaytonaSandboxOps } from "zeitlich/adapters/sandbox/daytona/workflow";
   *
   * const researcher: SubagentConfig = {
   *   agentName: "researcher",
   *   workflow: researcherWorkflow,
   *   sandbox: {
   *     source: "own",
   *     continuation: "snapshot",
   *     proxy: proxyDaytonaSandboxOps,
   *   },
   * };
   * ```
   */
  sandbox?: SubagentSandboxConfig;
}

/**
 * Per-subagent lifecycle hooks - defined on a SubagentConfig.
 * Runs in addition to global hooks (global pre → subagent pre → execute → subagent post → global post).
 */
export interface SubagentHooks<TArgs = unknown, TResult = unknown> {
  /** Called before this subagent executes - can skip or modify args */
  onPreExecution?: (ctx: {
    args: TArgs;
    threadId: string;
    turn: number;
  }) => PreToolUseHookResult | Promise<PreToolUseHookResult>;
  /** Called after this subagent executes successfully */
  onPostExecution?: (ctx: {
    args: TArgs;
    result: TResult;
    threadId: string;
    turn: number;
    durationMs: number;
    /** Unvalidated metadata from the child workflow (e.g. infrastructure state) */
    metadata?: Record<string, unknown>;
  }) => void | Promise<void>;
  /** Called when this subagent execution fails */
  onExecutionFailure?: (ctx: {
    args: TArgs;
    error: Error;
    threadId: string;
    turn: number;
  }) => PostToolUseFailureHookResult | Promise<PostToolUseFailureHookResult>;
}

/**
 * Response returned from a subagent workflow `fn`.
 *
 * When `TSandboxShutdown` is `"pause-until-parent-close"` or
 * `"keep-until-parent-close"`, the parent needs the `sandboxId` to destroy
 * the sandbox at its own shutdown, so the field becomes required.
 */
export type SubagentFnResult<
  TResult = null,
  TSandboxShutdown extends SubagentSandboxShutdown = SubagentSandboxShutdown,
> = SubagentHandlerResponse<TResult> &
  (TSandboxShutdown extends
    | "pause-until-parent-close"
    | "keep-until-parent-close"
    ? { sandboxId: string }
    : { sandboxId?: string });

/** Payload sent by a child workflow as soon as its sandbox is ready */
export interface ChildSandboxReadySignalPayload {
  childWorkflowId: string;
  sandboxId: string;
  /**
   * Present only when the session captured a seed snapshot on this run
   * (`continuation === "snapshot"` + fresh creation). Allows the parent to
   * publish the reusable base snapshot to concurrent waiters without
   * blocking on the child workflow's completion.
   */
  baseSnapshot?: SandboxSnapshot;
}

/**
 * Session config fields passed from parent to child workflow.
 */
export interface SubagentSessionInput {
  /** Agent name — spread directly into `createSession` */
  agentName: string;
  /** Thread initialization strategy */
  thread?: ThreadInit;
  /** Sandbox initialization strategy */
  sandbox?: SandboxInit;
  /** Sandbox shutdown policy (default: "destroy") */
  sandboxShutdown?: SubagentSandboxShutdown;
  /**
   * Called by the session as soon as the sandbox is created, before the
   * agent loop starts. `baseSnapshot` is populated only when the session
   * captured a seed snapshot (fresh creation + `sandboxShutdown === "snapshot"`).
   */
  onSandboxReady?: (args: {
    sandboxId: string;
    baseSnapshot?: SandboxSnapshot;
  }) => void;
  /**
   * Called by the session right before `runSession` returns. Installed by
   * `defineSubagentWorkflow` to capture sandbox outputs and auto-forward
   * them to the subagent's final result so user code never has to thread
   * `sandboxId` / `snapshot` manually.
   */
  onSessionExit?: (result: {
    sandboxId?: string;
    snapshot?: SandboxSnapshot;
    threadId: string;
  }) => void;
}
