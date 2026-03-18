import type {
  PreToolUseHookResult,
  PostToolUseFailureHookResult,
  ToolHooks,
  ToolMap,
} from "../tool-router/types";
import type { SubagentConfig, SubagentHooks } from "./types";
import type { SubagentPlugin } from "./plugin";
import type { z } from "zod";
import { createSubagentTool, SUBAGENT_TOOL_NAME, type SubagentArgs } from "./tool";
import { createSubagentHandler } from "./handler";
import {
  createSubagentEventBase,
  emitSubagentPluginEvent,
  serializeSubagentPluginError,
} from "./plugin";

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
  subagentPlugins: readonly SubagentPlugin[] = []
): ToolMap[string] | null {
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

  const resolveSubagent = (args: unknown): SubagentConfig | undefined =>
    subagents.find((s) => s.agentName === resolveSubagentName(args));

  return {
    name: SUBAGENT_TOOL_NAME,
    enabled: (): boolean => getEnabled().length > 0,
    description: (): string => createSubagentTool(getEnabled()).description,
    schema: (): z.ZodObject<z.ZodRawShape> => createSubagentTool(getEnabled()).schema,
    handler: createSubagentHandler(subagents, subagentPlugins),
    ...((subagentHooksMap.size > 0 || subagentPlugins.length > 0) && {
      hooks: {
        onPreToolUse: async (ctx): Promise<PreToolUseHookResult> => {
          const subagent = resolveSubagent(ctx.args);
          const hooks = subagentHooksMap.get(resolveSubagentName(ctx.args));
          const preResult = (await hooks?.onPreExecution?.(ctx)) ?? {};

          if (!preResult.skip && subagent) {
            await emitSubagentPluginEvent(subagentPlugins, {
              ...createSubagentEventBase({
                subagentArgs: ctx.args as SubagentArgs,
                context: {
                  threadId: ctx.threadId,
                  turn: ctx.turn,
                },
                config: subagent,
              }),
              phase: "tool",
              status: "start",
              timestampMs: Date.now(),
            });
          }

          return preResult;
        },
        onPostToolUse: async (ctx): Promise<void> => {
          const subagent = resolveSubagent(ctx.args);
          const hooks = subagentHooksMap.get(resolveSubagentName(ctx.args));
          await hooks?.onPostExecution?.(ctx);

          if (!subagent) {
            return;
          }

          await emitSubagentPluginEvent(subagentPlugins, {
            ...createSubagentEventBase({
              subagentArgs: ctx.args as SubagentArgs,
              context: {
                threadId: ctx.threadId,
                turn: ctx.turn,
              },
              config: subagent,
            }),
            phase: "tool",
            status: "success",
            timestampMs: Date.now(),
            durationMs: ctx.durationMs,
            result: ctx.result,
          });
        },
        onPostToolUseFailure: async (
          ctx
        ): Promise<PostToolUseFailureHookResult> => {
          const subagent = resolveSubagent(ctx.args);
          const hooks = subagentHooksMap.get(resolveSubagentName(ctx.args));
          const failureResult = (await hooks?.onExecutionFailure?.(ctx)) ?? {};

          if (subagent) {
            await emitSubagentPluginEvent(subagentPlugins, {
              ...createSubagentEventBase({
                subagentArgs: ctx.args as SubagentArgs,
                context: {
                  threadId: ctx.threadId,
                  turn: ctx.turn,
                },
                config: subagent,
              }),
              phase: "tool",
              status: "failure",
              timestampMs: Date.now(),
              error: serializeSubagentPluginError(ctx.error),
            });
          }

          return failureResult;
        },
      } satisfies ToolHooks,
    }),
  };
}
