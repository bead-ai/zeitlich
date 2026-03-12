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

/**
 * Input shape supported by {@link defineWorkflow}.
 * You can extend this with any additional fields your workflow needs.
 */
export interface WorkflowInput {
  /** When set, continue this thread instead of starting fresh */
  previousThreadId?: string;
  /** Optional sandbox ID to reuse */
  sandboxId?: string;
}

/**
 * Wraps a main workflow function, translating input fields into
 * session-compatible fields that can be spread directly into `createSession`.
 *
 * The wrapper:
 * - Derives `threadId` + `continueThread` from `previousThreadId`
 * - Derives `sandboxId` from input
 * - Passes the full typed input as the first argument
 */
export function defineWorkflow<TInput extends WorkflowInput, TResult>(
  fn: (input: TInput, sessionInput: WorkflowSessionInput) => Promise<TResult>,
): (input: TInput) => Promise<TResult> {
  return async (input) => {
    const sessionInput: WorkflowSessionInput = {
      ...(input.previousThreadId && {
        threadId: input.previousThreadId,
        continueThread: true,
      }),
      ...(input.sandboxId && { sandboxId: input.sandboxId }),
    };
    return fn(input, sessionInput);
  };
}
