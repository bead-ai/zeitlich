import type {
  PreToolUseHookResult,
  PostToolUseFailureHookResult,
  ToolHooks,
  ToolMap,
} from "../tool-router/types";
import type { SubagentConfig, SubagentHooks } from "./types";
import type { z } from "zod";
import { createSubagentTool, SUBAGENT_TOOL_NAME, type SubagentArgs } from "./tool";
import { createSubagentHandler } from "./handler";

/**
 * Builds a fully wired tool entry for the Subagent tool,
 * including per-subagent hook delegation.
 *
 * Lazily evaluates `enabled` (supports `boolean | () => boolean`)
 * so that `description` and `schema` reflect the current set of
 * active subagents each time getToolDefinitions() is called.
 *
 * Returns null if no subagents are configured.
 */
export function buildSubagentRegistration(
  subagents: SubagentConfig[],
  options?: {
    getSandboxStateForInheritance?: () => Record<string, unknown> | undefined;
  },
): {
  registration: ToolMap[string];
  destroySubagentSandboxes: () => Promise<void>;
} | null {
  if (subagents.length === 0) return null;

  const getEnabled = (): SubagentConfig[] =>
    subagents.filter((s) =>
      typeof s.enabled === "function" ? s.enabled() : (s.enabled ?? true),
    );

  const subagentHooksMap = new Map<string, SubagentHooks>();
  for (const s of subagents) {
    if (s.hooks) subagentHooksMap.set(s.agentName, s.hooks);
  }

  const resolveSubagentName = (args: unknown): string =>
    (args as SubagentArgs).subagent;

  const { handler, destroySubagentSandboxes } = createSubagentHandler(subagents, {
    getSandboxStateForInheritance: options?.getSandboxStateForInheritance,
  });

  const registration: ToolMap[string] = {
    name: SUBAGENT_TOOL_NAME,
    enabled: (): boolean => getEnabled().length > 0,
    description: (): string => createSubagentTool(getEnabled()).description,
    schema: (): z.ZodObject<z.ZodRawShape> => createSubagentTool(getEnabled()).schema,
    handler,
    ...(subagentHooksMap.size > 0 && {
      hooks: {
        onPreToolUse: async (ctx): Promise<PreToolUseHookResult> => {
          const hooks = subagentHooksMap.get(resolveSubagentName(ctx.args));
          return hooks?.onPreExecution?.(ctx) ?? {};
        },
        onPostToolUse: async (ctx): Promise<void> => {
          const hooks = subagentHooksMap.get(resolveSubagentName(ctx.args));
          await hooks?.onPostExecution?.(ctx);
        },
        onPostToolUseFailure: async (
          ctx
        ): Promise<PostToolUseFailureHookResult> => {
          const hooks = subagentHooksMap.get(resolveSubagentName(ctx.args));
          return hooks?.onExecutionFailure?.(ctx) ?? {};
        },
      } satisfies ToolHooks,
    }),
  };

  return { registration, destroySubagentSandboxes };
}
