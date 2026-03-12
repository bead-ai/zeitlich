import type { z } from "zod";
import type { SubagentArgs } from "./tool";
import type {
  SubagentConfig,
  SubagentHandlerResponse,
  SubagentHooks,
} from "./types";

/**
 * Identity function that provides full type inference for subagent configurations.
 * Verifies the workflow function's input parameters match the configured context,
 * and properly types the lifecycle hooks with Task tool args and inferred result type.
 *
 * @example
 * ```ts
 * // With typed context — workflow must accept { prompt, context }
 * const researcher = defineSubagent({
 *   name: "researcher",
 *   description: "Researches topics",
 *   workflow: researcherWorkflow, // (input: { prompt: string; context: { apiKey: string } }) => Promise<...>
 *   context: { apiKey: "..." },
 *   resultSchema: z.object({ findings: z.string() }),
 *   hooks: {
 *     onPostExecution: ({ result }) => {
 *       // result is typed as { findings: string }
 *     },
 *   },
 * });
 *
 * // Without context — workflow only needs { prompt }
 * const writer = defineSubagent({
 *   name: "writer",
 *   description: "Writes content",
 *   workflow: writerWorkflow, // (input: { prompt: string }) => Promise<...>
 *   resultSchema: z.object({ content: z.string() }),
 * });
 * ```
 */
// With context — verifies workflow accepts { prompt, context: TContext }
export function defineSubagent<
  TResult extends z.ZodType = z.ZodType,
  TContext extends Record<string, unknown> = Record<string, unknown>,
>(
  config: Omit<SubagentConfig<TResult>, "hooks" | "workflow" | "context"> & {
    workflow:
      | string
      | ((input: {
          prompt: string;
          previousThreadId?: string;
          context: TContext;
        }) => Promise<SubagentHandlerResponse<z.infer<TResult> | null>>);
    context: TContext;
    hooks?: SubagentHooks<SubagentArgs, z.infer<TResult>>;
  },
): SubagentConfig<TResult>;
// Without context — verifies workflow accepts { prompt }
export function defineSubagent<TResult extends z.ZodType = z.ZodType>(
  config: Omit<SubagentConfig<TResult>, "hooks" | "workflow"> & {
    workflow:
      | string
      | ((input: {
          prompt: string;
          previousThreadId?: string;
        }) => Promise<SubagentHandlerResponse<z.infer<TResult> | null>>);
    hooks?: SubagentHooks<SubagentArgs, z.infer<TResult>>;
  },
): SubagentConfig<TResult>;
// biome-ignore lint/suspicious/noExplicitAny: overload implementation signature
export function defineSubagent(config: any): SubagentConfig {
  return config;
}
