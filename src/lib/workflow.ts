import type { ThreadInit, SandboxInit, SandboxShutdown } from "./lifecycle";

/**
 * Session config fields derived from a main workflow input, ready to spread
 * into `createSession`.
 */
export interface WorkflowSessionInput {
  /** Agent name — spread directly into `createSession` */
  agentName: string;
  /** Thread initialization strategy */
  thread?: ThreadInit;
  /** Sandbox initialization strategy */
  sandbox?: SandboxInit;
  /** Sandbox shutdown policy (default: "destroy") */
  sandboxShutdown?: SandboxShutdown;
}

/** Raw workflow input fields that map into `WorkflowSessionInput`. */
export interface WorkflowInput {
  /** Thread initialization strategy (default: `{ mode: "new" }`) */
  thread?: ThreadInit;
  /** Sandbox initialization strategy */
  sandbox?: SandboxInit;
}

export interface WorkflowConfig {
  /** Workflow name — used as the Temporal workflow function name */
  name: string;
  /**
   * Sandbox shutdown policy applied when the main agent session exits.
   *
   * - `"destroy"` (default) — destroy the sandbox on exit.
   * - `"pause"` — pause the sandbox so it can be resumed later.
   * - `"keep"` — leave the sandbox running (no-op on exit).
   */
  sandboxShutdown?: SandboxShutdown;
}

/**
 * Wraps a main workflow function, translating workflow input fields into
 * session-compatible fields that can be spread directly into `createSession`.
 *
 * The wrapper:
 * - Accepts a `config` with at least a `name` (used for Temporal workflow naming)
 * - Accepts a handler `fn` receiving `(input, sessionInput)`
 * - Derives thread / sandbox init from `workflowInput`
 * - Applies the configured `sandboxShutdown` policy
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
      sandboxShutdown: config.sandboxShutdown ?? "destroy",
      ...(workflowInput.thread && { thread: workflowInput.thread }),
      ...(workflowInput.sandbox && { sandbox: workflowInput.sandbox }),
    };
    return fn(input, sessionInput);
  };

  Object.defineProperty(workflow, "name", { value: config.name });

  return workflow;
}
