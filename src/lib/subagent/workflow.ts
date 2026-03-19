import type { z } from "zod";
import {
  workflowInfo,
  getExternalWorkflowHandle,
} from "@temporalio/workflow";
import type {
  SubagentDefinition,
  SubagentHandlerResponse,
  SubagentWorkflowInput,
  SubagentSessionInput,
} from "./types";
import { childResultSignal } from "./signals";

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
// Without resultSchema — data is null
export function defineSubagentWorkflow<
  TContext extends Record<string, unknown> = Record<string, unknown>,
>(
  config: { name: string; description: string },
  fn: (
    prompt: string,
    sessionInput: SubagentSessionInput,
    context: TContext
  ) => Promise<SubagentHandlerResponse<null>>
): SubagentDefinition<z.ZodNull, TContext>;
// With resultSchema — data is inferred from the schema
export function defineSubagentWorkflow<
  TResult extends z.ZodType,
  TContext extends Record<string, unknown> = Record<string, unknown>,
>(
  config: { name: string; description: string; resultSchema: TResult },
  fn: (
    prompt: string,
    sessionInput: SubagentSessionInput,
    context: TContext
  ) => Promise<SubagentHandlerResponse<z.infer<TResult> | null>>
): SubagentDefinition<TResult, TContext>;
export function defineSubagentWorkflow(
  config: { name: string; description: string; resultSchema?: z.ZodType },
  fn: (
    prompt: string,
    sessionInput: SubagentSessionInput,
    context: Record<string, unknown>
  ) => Promise<SubagentHandlerResponse<unknown>>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): SubagentDefinition<any, any> {
  const workflow = async (
    prompt: string,
    workflowInput: SubagentWorkflowInput,
    context?: Record<string, unknown>
  ): Promise<SubagentHandlerResponse<unknown>> => {
    const sessionInput: SubagentSessionInput = {
      agentName: config.name,
      ...(workflowInput.previousThreadId && {
        threadId: workflowInput.previousThreadId,
        continueThread: true,
      }),
      ...(workflowInput.sandboxId && { sandboxId: workflowInput.sandboxId }),
    };
    const result = await fn(prompt, sessionInput, context ?? {});

    const { parent } = workflowInfo();
    if (parent) {
      const parentHandle = getExternalWorkflowHandle(parent.workflowId);
      await parentHandle.signal(childResultSignal, {
        childWorkflowId: workflowInfo().workflowId,
        result,
      });
    }

    return result;
  };

  // for temporal workflow name
  Object.defineProperty(workflow, "name", { value: config.name });

  return Object.assign(workflow, {
    agentName: config.name,
    description: config.description,
    ...(config.resultSchema !== undefined && {
      resultSchema: config.resultSchema,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as SubagentDefinition<any, any>;
}
