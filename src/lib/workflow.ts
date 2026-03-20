import type { ContinuationMode } from "./types";
import type { SandboxOnExitPolicy } from "./subagent/types";

/**
 * Session config fields derived from a main workflow input, ready to spread
 * into `createSession`.
 */
export interface WorkflowSessionInput {
  /** Agent name — spread directly into `createSession` */
  agentName: string;
  /** Thread ID to continue (set from `input.previousThreadId`) */
  threadId?: string;
  /** Whether to continue an existing thread (true when `previousThreadId` is present) */
  continueThread?: boolean;
  /**
   * How to handle the previous thread when `continueThread` is true.
   *
   * - `"fork"` (default) — copy messages into a new thread.
   * - `"continue"` — write directly to the existing thread.
   */
  threadContinuationMode?: ContinuationMode;
  /** Optional sandbox ID forwarded to the session (inherited — session does NOT own it) */
  sandboxId?: string;
  /** Previously-paused sandbox ID to fork from or resume */
  previousSandboxId?: string;
  /**
   * How to handle the previous sandbox when `previousSandboxId` is set.
   *
   * - `"fork"` (default) — create a new sandbox from the previous state.
   * - `"continue"` — resume the same sandbox directly.
   */
  sandboxContinuationMode?: ContinuationMode;
  /** Sandbox lifecycle policy when the session exits (default: `"destroy"`) */
  sandboxOnExit?: SandboxOnExitPolicy;
}

/** Raw workflow input fields that map into `WorkflowSessionInput`. */
export interface WorkflowInput {
  /** When set, continue this thread instead of starting fresh */
  previousThreadId?: string;
  /**
   * How to handle the previous thread.
   *
   * - `"fork"` (default) — copy messages into a new thread.
   * - `"continue"` — write directly to the existing thread.
   */
  threadContinuationMode?: ContinuationMode;
  /** Optional sandbox ID to inherit (session does NOT own it) */
  sandboxId?: string;
  /** Previously-paused sandbox ID to fork from or resume */
  previousSandboxId?: string;
  /**
   * How to handle the previous sandbox.
   *
   * - `"fork"` (default) — create a new sandbox from the previous state.
   * - `"continue"` — resume the same sandbox directly.
   */
  sandboxContinuationMode?: ContinuationMode;
  /** Sandbox lifecycle policy when the workflow exits (default: `"destroy"`) */
  sandboxOnExit?: SandboxOnExitPolicy;
}

export interface WorkflowConfig {
  /** Workflow name — used as the Temporal workflow function name */
  name: string;
}

/**
 * Wraps a main workflow function, translating workflow input fields into
 * session-compatible fields that can be spread directly into `createSession`.
 *
 * The wrapper:
 * - Accepts a `config` with at least a `name` (used for Temporal workflow naming)
 * - Accepts a handler `fn` receiving `(input, sessionInput)`
 * - Derives `threadId` + `continueThread` from `workflowInput.previousThreadId`
 * - Derives `sandboxId` from `workflowInput.sandboxId`
 */
export function defineWorkflow<TInput, TResult>(
  config: WorkflowConfig,
  fn: (input: TInput, sessionInput: WorkflowSessionInput) => Promise<TResult>
): (input: TInput, workflowInput?: WorkflowInput) => Promise<TResult> {
  const workflow = async (
    input: TInput,
    workflowInput: WorkflowInput = {}
  ): Promise<TResult> => {
    const sessionInput: WorkflowSessionInput = {
      agentName: config.name,
      ...(workflowInput.previousThreadId && {
        threadId: workflowInput.previousThreadId,
        continueThread: true,
        ...(workflowInput.threadContinuationMode && {
          threadContinuationMode: workflowInput.threadContinuationMode,
        }),
      }),
      ...(workflowInput.sandboxId && { sandboxId: workflowInput.sandboxId }),
      ...(workflowInput.previousSandboxId && {
        previousSandboxId: workflowInput.previousSandboxId,
        ...(workflowInput.sandboxContinuationMode && {
          sandboxContinuationMode: workflowInput.sandboxContinuationMode,
        }),
      }),
      ...(workflowInput.sandboxOnExit && {
        sandboxOnExit: workflowInput.sandboxOnExit,
      }),
    };
    return fn(input, sessionInput);
  };

  Object.defineProperty(workflow, "name", { value: config.name });

  return workflow;
}
