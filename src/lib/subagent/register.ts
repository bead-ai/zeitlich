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
 * Uses getters for `enabled`, `description`, and `schema` so that
 * dynamic changes to SubagentConfig.enabled are re-evaluated each
 * time getToolDefinitions() is called.
 *
 * Returns null if no subagents are configured.
 */
export function buildSubagentRegistration(
  subagents: SubagentConfig[]
): ToolMap[string] | null {
  if (subagents.length === 0) return null;

  const getEnabled = (): SubagentConfig[] => subagents.filter((s) => s.enabled ?? true);

  const subagentHooksMap = new Map<string, SubagentHooks>();
  for (const s of subagents) {
    if (s.hooks) subagentHooksMap.set(s.agentName, s.hooks);
  }

  const resolveSubagentName = (args: unknown): string =>
    (args as SubagentArgs).subagent;

  return {
    name: SUBAGENT_TOOL_NAME,
    get enabled(): boolean {
      return getEnabled().length > 0;
    },
    get description(): string {
      return createSubagentTool(getEnabled()).description;
    },
    get schema(): z.ZodObject<z.ZodRawShape> {
      return createSubagentTool(getEnabled()).schema;
    },
    handler: createSubagentHandler(subagents),
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
}
