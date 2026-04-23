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
import type { SandboxOps, SandboxSnapshot } from "../sandbox/types";

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
 */
export type SubagentSandboxConfig =
  | "none"
  | {
      source: "inherit";
      continuation: "continue" | "fork";
      shutdown?: SubagentSandboxShutdown;
      proxy: (scope: string) => SandboxOps;
    }
  | {
      source: "own";
      init?: "per-call" | "once";
      continuation: "continue" | "fork" | "snapshot";
      shutdown?: SubagentSandboxShutdown;
      proxy: (scope: string) => SandboxOps;
    };

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
