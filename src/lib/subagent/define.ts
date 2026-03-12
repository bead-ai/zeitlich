import type { z } from "zod";
import type {
  SubagentConfig,
  SubagentHandlerResponse,
  SubagentHooks,
  SubagentWorkflowInput,
} from "./types";
import type { SubagentArgs } from "./tool";

/**
 * Identity function that provides full type inference for subagent configurations.
 * Verifies the workflow function's input parameters match the configured context,
 * and properly types the lifecycle hooks with Task tool args and inferred result type.
 *
 * @example
 * ```ts
 * // With typed context — workflow receives prompt, workflowInput, context
 * const researcher = defineSubagent({
 *   name: "researcher",
 *   description: "Researches topics",
 *   workflow: researcherWorkflow, // (prompt, workflowInput, context?: { apiKey: string }) => Promise<...>
 *   context: { apiKey: "..." },
 *   resultSchema: z.object({ findings: z.string() }),
 *   hooks: {
 *     onPostExecution: ({ result }) => {
 *       // result is typed as { findings: string }
 *     },
 *   },
 * });
 *
 * // Without context — workflow only needs prompt + workflowInput
 * const writer = defineSubagent({
 *   name: "writer",
 *   description: "Writes content",
 *   workflow: writerWorkflow, // (prompt, workflowInput) => Promise<...>
 *   resultSchema: z.object({ content: z.string() }),
 * });
 * ```
 */
// With context — verifies workflow accepts (prompt, workflowInput, context?)
export function defineSubagent<
  TResult extends z.ZodType = z.ZodType,
  TContext extends Record<string, unknown> = Record<string, unknown>,
>(
  config: Omit<SubagentConfig<TResult>, "hooks" | "workflow" | "context"> & {
    workflow:
      | string
      | ((
          prompt: string,
          workflowInput: SubagentWorkflowInput,
          context?: TContext,
        ) => Promise<SubagentHandlerResponse<z.infer<TResult> | null>>);
    context: TContext;
    hooks?: SubagentHooks<SubagentArgs, z.infer<TResult>>;
  }
): SubagentConfig<TResult>;
// Without context — verifies workflow accepts (prompt, workflowInput)
export function defineSubagent<TResult extends z.ZodType = z.ZodType>(
  config: Omit<SubagentConfig<TResult>, "hooks" | "workflow"> & {
    workflow:
      | string
      | ((
          prompt: string,
          workflowInput: SubagentWorkflowInput,
        ) => Promise<SubagentHandlerResponse<z.infer<TResult> | null>>);
    hooks?: SubagentHooks<SubagentArgs, z.infer<TResult>>;
  }
): SubagentConfig<TResult>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineSubagent(config: any): SubagentConfig {
  return config;
}
