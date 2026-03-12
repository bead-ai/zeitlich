import type { z } from "zod";
import type {
  SubagentConfig,
  SubagentHandlerResponse,
  SubagentHooks,
} from "./types";
import type { SubagentArgs } from "./tool";

/**
 * Identity function that provides full type inference for subagent configurations.
 * Verifies the workflow function's input parameters match the configured context
 * and/or settings, and properly types the lifecycle hooks with Task tool args
 * and inferred result type.
 *
 * @example
 * ```ts
 * // With typed settings (resolved from parent state at invocation time)
 * const researcher = defineSubagent({
 *   agentName: "researcher",
 *   description: "Researches topics",
 *   workflow: researcherWorkflow,
 *   resolveSettings: () => ({ model: stateManager.get("model") }),
 *   resultSchema: z.object({ findings: z.string() }),
 * });
 *
 * // With both context and settings
 * const writer = defineSubagent({
 *   agentName: "writer",
 *   description: "Writes content",
 *   workflow: writerWorkflow,
 *   context: { apiKey: "..." },
 *   resolveSettings: () => ({ tone: stateManager.get("tone") }),
 *   resultSchema: z.object({ content: z.string() }),
 * });
 *
 * // With typed context only (static)
 * const basic = defineSubagent({
 *   agentName: "basic",
 *   description: "Basic agent",
 *   workflow: basicWorkflow,
 *   context: { apiKey: "..." },
 * });
 *
 * // Minimal — no context or settings
 * const simple = defineSubagent({
 *   agentName: "simple",
 *   description: "Simple agent",
 *   workflow: simpleWorkflow,
 * });
 * ```
 */
// ── Overload 1: context + resolveSettings ──
export function defineSubagent<
  TResult extends z.ZodType = z.ZodType,
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TSettings extends Record<string, unknown> = Record<string, unknown>,
>(
  config: Omit<
    SubagentConfig<TResult, TSettings>,
    "hooks" | "workflow" | "context" | "resolveSettings"
  > & {
    workflow:
      | string
      | ((input: {
          prompt: string;
          previousThreadId?: string;
          context: TContext;
          settings: TSettings;
        }) => Promise<SubagentHandlerResponse<z.infer<TResult> | null>>);
    context: TContext;
    resolveSettings: () => TSettings;
    hooks?: SubagentHooks<SubagentArgs, z.infer<TResult>>;
  }
): SubagentConfig<TResult, TSettings>;
// ── Overload 2: resolveSettings only ──
export function defineSubagent<
  TResult extends z.ZodType = z.ZodType,
  TSettings extends Record<string, unknown> = Record<string, unknown>,
>(
  config: Omit<
    SubagentConfig<TResult, TSettings>,
    "hooks" | "workflow" | "resolveSettings"
  > & {
    workflow:
      | string
      | ((input: {
          prompt: string;
          previousThreadId?: string;
          settings: TSettings;
        }) => Promise<SubagentHandlerResponse<z.infer<TResult> | null>>);
    resolveSettings: () => TSettings;
    hooks?: SubagentHooks<SubagentArgs, z.infer<TResult>>;
  }
): SubagentConfig<TResult, TSettings>;
// ── Overload 3: context only ──
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
  }
): SubagentConfig<TResult>;
// ── Overload 4: basic (no context, no settings) ──
export function defineSubagent<TResult extends z.ZodType = z.ZodType>(
  config: Omit<SubagentConfig<TResult>, "hooks" | "workflow"> & {
    workflow:
      | string
      | ((input: {
          prompt: string;
          previousThreadId?: string;
        }) => Promise<SubagentHandlerResponse<z.infer<TResult> | null>>);
    hooks?: SubagentHooks<SubagentArgs, z.infer<TResult>>;
  }
): SubagentConfig<TResult>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineSubagent(config: any): SubagentConfig {
  return config;
}
