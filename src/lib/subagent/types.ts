import type { z } from "zod";
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

/** ToolHandlerResponse with threadId required (subagents must always surface their thread) */
export type SubagentHandlerResponse<TResult = null, TToolResponse = JsonValue> =
  ToolHandlerResponse<TResult, TToolResponse> & { threadId: string; sandboxId?: string };

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
 * - `{ source: "inherit", continuation }` — reuse the parent's sandbox.
 *   `continuation: "continue"` shares the parent sandbox directly;
 *   `continuation: "fork"` forks from the parent on every call.
 * - `{ source: "own", init?, continuation }` — the child gets its own sandbox.
 *   `init: "per-call"` (default) creates fresh each call (thread continuation
 *   uses the previous sandbox). `init: "once"` creates on the first call and
 *   stores it for all subsequent calls.
 */
export type SubagentSandboxConfig =
  | "none"
  | {
      source: "inherit";
      continuation: "continue" | "fork";
      shutdown?: SubagentSandboxShutdown;
    }
  | {
      source: "own";
      init?: "per-call" | "once";
      continuation: "continue" | "fork";
      shutdown?: SubagentSandboxShutdown;
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
 * Extended response from the subagent `fn` — includes optional cleanup callbacks
 * stripped before signaling the parent.
 *
 * When `TSandboxShutdown` is `"pause-until-parent-close"` or
 * `"keep-until-parent-close"`, both `destroySandbox` and `sandboxId` become
 * required so the parent can coordinate cleanup.
 */
export type SubagentFnResult<
  TResult = null,
  TSandboxShutdown extends SubagentSandboxShutdown = SubagentSandboxShutdown,
> = SubagentHandlerResponse<TResult> &
  (TSandboxShutdown extends
    | "pause-until-parent-close"
    | "keep-until-parent-close"
    ? { destroySandbox: () => Promise<void>; sandboxId: string }
    : { destroySandbox?: () => Promise<void> });

/** Payload sent by a child workflow to signal its result back to the parent */
export interface ChildResultSignalPayload {
  childWorkflowId: string;
  result: SubagentHandlerResponse;
}

/** Payload sent by a child workflow as soon as its sandbox is ready */
export interface ChildSandboxReadySignalPayload {
  childWorkflowId: string;
  sandboxId: string;
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
  /** Called by the session as soon as the sandbox is created, before the agent loop starts. */
  onSandboxReady?: (sandboxId: string) => void;
}
