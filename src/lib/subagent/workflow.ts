import type { z } from "zod";
import type {
  SubagentDefinition,
  SubagentHandlerResponse,
  SubagentWorkflowInput,
  SubagentSessionInput,
} from "./types";

/**
 * Defines a subagent workflow with embedded metadata (name, description, resultSchema).
 * The returned value can be passed directly to `defineSubagent` — no need to repeat
 * the name, description, or resultSchema in the parent workflow.
 *
 * Internally maps `SubagentWorkflowInput` fields to session-compatible `SubagentSessionInput`.
 *
 * @example
 * ```ts
 * import {
 *   defineSubagentWorkflow,
 *   defineSubagent,
 *   createSession,
 *   createAgentStateManager,
 * } from 'zeitlich/workflow';
 *
 * // Define once — carries name, description, resultSchema
 * export const researcherWorkflow = defineSubagentWorkflow(
 *   {
 *     name: "researcher",
 *     description: "Researches topics on the web",
 *     resultSchema: z.object({ findings: z.string() }),
 *   },
 *   async (prompt, sessionInput) => {
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
 *
 * // Use in parent — only configure what's parent-specific
 * export const researcher = defineSubagent(researcherWorkflow, {
 *   hooks: { onPostExecution: ({ result }) => console.log(result) },
 * });
 * ```
 */
export function defineSubagentWorkflow<
  TResult extends z.ZodType = z.ZodType,
  TContext extends Record<string, unknown> = Record<string, unknown>,
>(
  config: {
    name: string;
    description: string;
    resultSchema?: TResult;
  },
  fn: (
    prompt: string,
    sessionInput: SubagentSessionInput,
    context?: TContext,
  ) => Promise<SubagentHandlerResponse<z.infer<TResult> | null>>,
): SubagentDefinition<TResult, TContext> {
  const workflow = async (
    prompt: string,
    workflowInput: SubagentWorkflowInput,
    context?: TContext,
  ): Promise<SubagentHandlerResponse<z.infer<TResult> | null>> => {
    const sessionInput: SubagentSessionInput = {
      agentName: config.name,
      ...(workflowInput.previousThreadId && {
        threadId: workflowInput.previousThreadId,
        continueThread: true,
      }),
      ...(workflowInput.sandboxId && { sandboxId: workflowInput.sandboxId }),
    };
    return fn(prompt, sessionInput, context);
  };

  return Object.assign(workflow, {
    agentName: config.name,
    description: config.description,
    ...(config.resultSchema !== undefined && { resultSchema: config.resultSchema }),
  }) as SubagentDefinition<TResult, TContext>;
}
