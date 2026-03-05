import type {
  PreToolUseHookResult,
  PostToolUseFailureHookResult,
  ToolHooks,
  ToolMap,
} from "../tool-router/types";
import type { SubagentConfig, SubagentHooks } from "./types";
import { createSubagentTool, type SubagentArgs } from "./tool";
import { createSubagentHandler } from "./handler";

/**
 * Builds a fully wired tool entry for the Subagent tool,
 * including per-subagent hook delegation.
 *
 * Returns null if no enabled subagents are configured.
 */
export function buildSubagentRegistration(
  subagents: SubagentConfig[]
): ToolMap[string] | null {
  const enabled = subagents.filter((s) => s.enabled ?? true);
  if (enabled.length === 0) return null;

  const subagentHooksMap = new Map<string, SubagentHooks>();
  for (const s of enabled) {
    if (s.hooks) subagentHooksMap.set(s.agentName, s.hooks);
  }

  const resolveSubagentName = (args: unknown): string =>
    (args as SubagentArgs).subagent;

  return {
    ...createSubagentTool(enabled),
    handler: createSubagentHandler(enabled),
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
