import type {
  SubagentHandlerResponse,
  SubagentInput,
  SubagentSessionInput,
} from "./types";

/**
 * Wraps a subagent workflow function, translating `SubagentInput` into
 * session-compatible fields that can be spread directly into `createSession`.
 *
 * The wrapper:
 * - Derives `threadId` + `continueThread` from `previousThreadId`
 * - Derives `sandboxId` from the inherited sandbox
 * - Passes the full typed `SubagentInput` as the first argument
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
 *   async (input, sessionInput) => {
 *     const stateManager = createAgentStateManager({
 *       initialState: { systemPrompt: "You are a researcher." },
 *     });
 *
 *     const session = await createSession({
 *       ...sessionInput,
 *       agentName: "researcher",
 *       runAgent: runAgentActivity,
 *       buildContextMessage: () => [{ type: "text", text: input.prompt }],
 *     });
 *
 *     const { finalMessage, threadId } = await session.runSession({ stateManager });
 *     return { toolResponse: finalMessage ?? "No response", data: null, threadId };
 *   },
 * );
 * ```
 */
export function defineSubagentWorkflow<
  TSettings extends Record<string, unknown> = Record<string, unknown>,
  TResult = null,
>(
  fn: (
    input: SubagentInput<TSettings>,
    sessionInput: SubagentSessionInput,
  ) => Promise<SubagentHandlerResponse<TResult>>,
): (input: SubagentInput<TSettings>) => Promise<SubagentHandlerResponse<TResult>> {
  return async (input) => {
    const sessionInput: SubagentSessionInput = {
      ...(input.previousThreadId && {
        threadId: input.previousThreadId,
        continueThread: true,
      }),
      ...(input.sandboxId && { sandboxId: input.sandboxId }),
    };
    return fn(input, sessionInput);
  };
}
