/**
 * Sandbox exit policy for the main agent workflow.
 * Only `"destroy"` and `"pause"` are valid — there is no parent to
 * coordinate `"pause-until-parent-close"`.
 */
export type MainAgentSandboxOnExitPolicy = "destroy" | "pause";

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
  /** Optional sandbox ID forwarded to the session */
  sandboxId?: string;
  /** Previously-paused sandbox ID to fork from (sandbox continuation) */
  previousSandboxId?: string;
  /** Sandbox lifecycle policy applied when this session exits */
  sandboxOnExit?: MainAgentSandboxOnExitPolicy;
}

/** Raw workflow input fields that map into `WorkflowSessionInput`. */
export interface WorkflowInput {
  /** When set, continue this thread instead of starting fresh */
  previousThreadId?: string;
  /** Optional sandbox ID to reuse */
  sandboxId?: string;
  /** Previously-paused sandbox ID to fork from */
  previousSandboxId?: string;
}

export interface WorkflowConfig {
  /** Workflow name — used as the Temporal workflow function name */
  name: string;
  /**
   * Sandbox lifecycle policy applied when the main agent session exits.
   *
   * - `"destroy"` (default) — destroy the sandbox on exit.
   * - `"pause"` — pause the sandbox so it can be resumed later.
   */
  sandboxOnExit?: MainAgentSandboxOnExitPolicy;
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
      sandboxOnExit: config.sandboxOnExit ?? "destroy",
      ...(workflowInput.previousThreadId && {
        threadId: workflowInput.previousThreadId,
        continueThread: true,
      }),
      ...(workflowInput.sandboxId && { sandboxId: workflowInput.sandboxId }),
      ...(workflowInput.previousSandboxId && {
        previousSandboxId: workflowInput.previousSandboxId,
      }),
    };
    return fn(input, sessionInput);
  };

  Object.defineProperty(workflow, "name", { value: config.name });

  return workflow;
}
