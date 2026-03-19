import type { z } from "zod";
import type {
  ToolHandlerResponse,
  PreToolUseHookResult,
  PostToolUseFailureHookResult,
} from "../tool-router/types";

/** ToolHandlerResponse with threadId required (subagents must always surface their thread) */
export type SubagentHandlerResponse<TResult = null> =
  ToolHandlerResponse<TResult> & { threadId: string; sandboxId?: string };

/**
 * Raw workflow input fields passed from parent to child workflow.
 * `defineSubagentWorkflow` maps this into `SubagentSessionInput`.
 */
export interface SubagentWorkflowInput {
  /** Thread ID from parent for continuation */
  previousThreadId?: string;
  /** Sandbox ID inherited from parent */
  sandboxId?: string;
  /** Sandbox ID to fork from */
  previousSandboxId?: string;
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
  /** Allow the parent agent to pass a threadId for this subagent to continue (default: false) */
  allowThreadContinuation?: boolean;
  /** Per-subagent lifecycle hooks */
  hooks?: SubagentHooks;
  /**
   * Sandbox strategy for this subagent.
   * - `'none'` (default): no sandbox — the subagent runs without sandbox access.
   * - `'inherit'`: reuse the parent's sandbox (shared filesystem/exec).
   * - `'own'`: the child creates and owns its own sandbox.
   */
  sandbox?: "none" | "inherit" | "own";
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

export type SandboxOnExitPolicy = "destroy" | "pause" | "pause-until-parent-close";

/**
 * Extended response from the subagent `fn` — includes optional cleanup callbacks
 * stripped before signaling the parent.
 *
 * When `TSandboxOnExit` is `"pause-until-parent-close"`, both `destroySandbox`
 * and `sandboxId` become required so the parent can coordinate cleanup.
 */
export type SubagentFnResult<
  TResult = null,
  TSandboxOnExit extends SandboxOnExitPolicy = SandboxOnExitPolicy,
> = SubagentHandlerResponse<TResult> &
  (TSandboxOnExit extends "pause-until-parent-close"
    ? { destroySandbox: () => Promise<void>; sandboxId: string }
    : { destroySandbox?: () => Promise<void> });

/** Payload sent by a child workflow to signal its result back to the parent */
export interface ChildResultSignalPayload {
  childWorkflowId: string;
  result: SubagentHandlerResponse;
}

/**
 * Session config fields passed from parent to child workflow.
 */
export interface SubagentSessionInput {
  /** Agent name — spread directly into `createSession` */
  agentName: string;
  /** Thread ID to continue from */
  threadId?: string;
  /** Whether to continue an existing thread */
  continueThread?: boolean;
  /** Sandbox ID inherited from the parent agent */
  sandboxId?: string;
  /** Previously-paused sandbox ID to fork from (sandbox continuation) */
  previousSandboxId?: string;
  /** What to do with the sandbox when the session ends (default: "destroy") */
  sandboxOnExit?: SandboxOnExitPolicy;
}
