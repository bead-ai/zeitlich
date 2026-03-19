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
}

/** Raw workflow input fields that map into `WorkflowSessionInput`. */
export interface WorkflowInput {
  /** When set, continue this thread instead of starting fresh */
  previousThreadId?: string;
  /** Optional sandbox ID to reuse */
  sandboxId?: string;
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
      }),
      ...(workflowInput.sandboxId && { sandboxId: workflowInput.sandboxId }),
    };
    return fn(input, sessionInput);
  };

  Object.defineProperty(workflow, "name", { value: config.name });

  return workflow;
}
