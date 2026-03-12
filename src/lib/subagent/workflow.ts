import type {
  SubagentHandlerResponse,
  SubagentWorkflowInput,
  SubagentSessionInput,
} from "./types";

/**
 * Wraps a subagent workflow function and maps parent workflow input fields
 * to session-compatible fields that can be spread into `createSession`.
 *
 * The wrapper:
 * - Derives `threadId` + `continueThread` from `previousThreadId`
 * - Derives `sandboxId` from inherited sandbox
 * - Passes optional static context as the third argument
 *
 * @example
 * ```ts
 * import {
 *   defineSubagentWorkflow,
 *   createSession,
 *   createAgentStateManager,
 * } from 'zeitlich/workflow';
 *
 * export const researcherWorkflow = defineSubagentWorkflow(
 *   async (prompt, sessionInput, context) => {
 *     const stateManager = createAgentStateManager({
 *       initialState: { systemPrompt: "You are a researcher." },
 *     });
 *
 *     const session = await createSession({
 *       ...sessionInput,
 *       agentName: "researcher",
 *       runAgent: runAgentActivity,
 *       buildContextMessage: () => [{ type: "text", text: prompt }],
 *     });
 *
 *     const { finalMessage, threadId } = await session.runSession({ stateManager });
 *     return { toolResponse: finalMessage ?? "No response", data: null, threadId };
 *   },
 * );
 * ```
 */
export function defineSubagentWorkflow<
  TResult = null,
  TContext extends Record<string, unknown> = Record<string, unknown>,
>(
  fn: (
    prompt: string,
    sessionInput: SubagentSessionInput,
    context?: TContext,
  ) => Promise<SubagentHandlerResponse<TResult>>,
): (
  prompt: string,
  workflowInput: SubagentWorkflowInput,
  context?: TContext,
) => Promise<SubagentHandlerResponse<TResult>> {
  return async (prompt, workflowInput, context) => {
    const sessionInput: SubagentSessionInput = {
      ...(workflowInput.previousThreadId && {
        threadId: workflowInput.previousThreadId,
        continueThread: true,
      }),
      ...(workflowInput.sandboxId && { sandboxId: workflowInput.sandboxId }),
    };
    return fn(prompt, sessionInput, context);
  };
}
