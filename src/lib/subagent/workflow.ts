import type { z } from "zod";
import {
  workflowInfo,
  getExternalWorkflowHandle,
  ApplicationFailure,
} from "@temporalio/workflow";
import type {
  SubagentDefinition,
  SubagentFnResult,
  SubagentHandlerResponse,
  SubagentWorkflowInput,
  SubagentSessionInput,
} from "./types";
import type { SubagentSandboxShutdown } from "../lifecycle";
import type { SandboxSnapshot } from "../sandbox/types";
import type { TokenUsage } from "../types";
import { childSandboxReadySignal } from "./signals";

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
 *     // `sandboxId`, `snapshot`, and `baseSnapshot` are auto-forwarded
 *     // from the session — no need to thread them through manually.
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
  TSandboxShutdown extends SubagentSandboxShutdown = "destroy",
  TContext extends Record<string, unknown> = Record<string, unknown>,
>(
  config: {
    name: string;
    description: string;
    sandboxShutdown?: TSandboxShutdown;
  },
  fn: (
    prompt: string,
    sessionInput: SubagentSessionInput,
    context: TContext
  ) => Promise<SubagentFnResult<null, TSandboxShutdown>>
): SubagentDefinition<z.ZodNull, TContext>;
// With resultSchema — data is inferred from the schema
export function defineSubagentWorkflow<
  TResult extends z.ZodType,
  TSandboxShutdown extends SubagentSandboxShutdown = "destroy",
  TContext extends Record<string, unknown> = Record<string, unknown>,
>(
  config: {
    name: string;
    description: string;
    resultSchema: TResult;
    sandboxShutdown?: TSandboxShutdown;
  },
  fn: (
    prompt: string,
    sessionInput: SubagentSessionInput,
    context: TContext
  ) => Promise<SubagentFnResult<z.infer<TResult> | null, TSandboxShutdown>>
): SubagentDefinition<TResult, TContext>;
export function defineSubagentWorkflow(
  config: {
    name: string;
    description: string;
    resultSchema?: z.ZodType;
    sandboxShutdown?: SubagentSandboxShutdown;
  },
  fn: (
    prompt: string,
    sessionInput: SubagentSessionInput,
    context: Record<string, unknown>
  ) => Promise<SubagentFnResult<unknown>>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): SubagentDefinition<any, any> {
  const workflow = async (
    prompt: string,
    workflowInput: SubagentWorkflowInput,
    context?: Record<string, unknown>
  ): Promise<SubagentHandlerResponse<unknown>> => {
    const effectiveShutdown =
      workflowInput.sandboxShutdown ?? config.sandboxShutdown ?? "destroy";

    const { parent } = workflowInfo();
    if (!parent) {
      throw ApplicationFailure.create({
        message: "Subagent workflow called without a parent workflow",
        nonRetryable: true,
      });
    }
    const parentHandle = getExternalWorkflowHandle(parent.workflowId);

    let capturedSandboxId: string | undefined;
    let capturedSnapshot: SandboxSnapshot | undefined;
    let capturedBaseSnapshot: SandboxSnapshot | undefined;
    let capturedThreadId: string | undefined;
    let capturedUsage: TokenUsage | undefined;
    const sessionInput: SubagentSessionInput = {
      agentName: config.name,
      sandboxShutdown: effectiveShutdown,
      ...(workflowInput.thread && { thread: workflowInput.thread }),
      ...(workflowInput.sandbox && { sandbox: workflowInput.sandbox }),
      onSandboxReady: ({ sandboxId, baseSnapshot }) => {
        capturedBaseSnapshot = baseSnapshot;
        const isReuse = workflowInput.sandbox?.mode === "continue";
        if (!isReuse) {
          void parentHandle.signal(childSandboxReadySignal, {
            childWorkflowId: workflowInfo().workflowId,
            sandboxId,
            ...(baseSnapshot && { baseSnapshot }),
          });
        }
      },
      onSessionExit: ({ sandboxId, snapshot, threadId, usage }) => {
        capturedSandboxId = sandboxId;
        capturedSnapshot = snapshot;
        capturedThreadId = threadId;
        capturedUsage = {
          inputTokens: usage.totalInputTokens,
          outputTokens: usage.totalOutputTokens,
          cachedWriteTokens: usage.totalCachedWriteTokens,
          cachedReadTokens: usage.totalCachedReadTokens,
          reasonTokens: usage.totalReasonTokens,
        };
      },
    };

    const result = await fn(prompt, sessionInput, context ?? {});

    // Auto-forward sandbox outputs captured from the session so user code
    // never has to thread them through manually. Explicit values on the fn
    // result take precedence.
    return {
      ...result,
      ...(capturedThreadId !== undefined && { threadId: capturedThreadId }),
      ...(capturedSandboxId !== undefined && { sandboxId: capturedSandboxId }),
      ...(capturedSnapshot !== undefined && { snapshot: capturedSnapshot }),
      ...(capturedBaseSnapshot !== undefined && {
        baseSnapshot: capturedBaseSnapshot,
      }),
      ...(capturedUsage !== undefined && { usage: capturedUsage }),
    };
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
