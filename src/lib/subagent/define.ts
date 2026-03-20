import type { z } from "zod";
import type {
  SubagentConfig,
  SubagentDefinition,
  SubagentHooks,
  SubagentSandboxConfig,
  SubagentWorkflow,
} from "./types";
import type { SubagentArgs } from "./tool";

/**
 * Creates a `SubagentConfig` from a `SubagentDefinition` (returned by `defineSubagentWorkflow`).
 * Metadata (name, description, resultSchema) is read from the definition — only configure
 * what's specific to this usage in the parent workflow.
 *
 * @example
 * ```ts
 * // Minimal — all metadata comes from the definition
 * export const researcher = defineSubagent(researcherWorkflow);
 *
 * // With parent-specific overrides
 * export const researcher = defineSubagent(researcherWorkflow, {
 *   thread: "fork",
 *   sandbox: { source: "own", shutdown: "pause" },
 *   hooks: {
 *     onPostExecution: ({ result }) => console.log(result),
 *   },
 * });
 *
 * // With typed context
 * export const researcher = defineSubagent(researcherWorkflow, {
 *   context: { apiKey: "..." },
 * });
 * ```
 */
export function defineSubagent<
  TResult extends z.ZodType = z.ZodType,
  TContext extends Record<string, unknown> = Record<string, unknown>,
>(
  definition: SubagentDefinition<TResult, TContext>,
  overrides?: {
    context?: TContext | (() => TContext);
    hooks?: SubagentHooks<SubagentArgs, z.infer<TResult>>;
    enabled?: boolean | (() => boolean);
    taskQueue?: string;
    thread?: "new" | "fork" | "continue";
    sandbox?: SubagentSandboxConfig;
  },
): SubagentConfig<TResult> {
  return {
    agentName: definition.agentName,
    description: definition.description,
    workflow: definition as SubagentWorkflow<TResult>,
    ...(definition.resultSchema !== undefined && {
      resultSchema: definition.resultSchema,
    }),
    ...overrides,
  } as SubagentConfig<TResult>;
}
