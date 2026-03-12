/**
 * Session config fields derived from a main workflow input, ready to spread
 * into `createSession`.
 */
export interface WorkflowSessionInput {
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

/**
 * Wraps a main workflow function, translating workflow input fields into
 * session-compatible fields that can be spread directly into `createSession`.
 *
 * The wrapper:
 * - Accepts a generic typed `input` as first argument
 * - Accepts optional `workflowInput` ({ previousThreadId, sandboxId }) as second argument
 * - Derives `threadId` + `continueThread` from `workflowInput.previousThreadId`
 * - Derives `sandboxId` from `workflowInput.sandboxId`
 */
export function defineWorkflow<TInput, TResult>(
  fn: (input: TInput, sessionInput: WorkflowSessionInput) => Promise<TResult>,
): (input: TInput, workflowInput?: WorkflowInput) => Promise<TResult> {
  return async (input, workflowInput = {}) => {
    const sessionInput: WorkflowSessionInput = {
      ...(workflowInput.previousThreadId && {
        threadId: workflowInput.previousThreadId,
        continueThread: true,
      }),
      ...(workflowInput.sandboxId && { sandboxId: workflowInput.sandboxId }),
    };
    return fn(input, sessionInput);
  };
}
