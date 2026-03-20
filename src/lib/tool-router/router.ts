import type { ToolMessageContent } from "../types";
import type {
  ToolMap,
  ToolDefinition,
  RouterContext,
  ToolHandler,
  RawToolCall,
  ParsedToolCallUnion,
  ParsedToolCall,
  ToolCallResult,
  ToolCallResultUnion,
  InferToolResults,
  ToolRouterOptions,
  ToolRouter,
  ToolNames,
  ToolArgs,
  ToolResult,
  ProcessToolCallsContext,
  ToolWithHandler,
} from "./types";

import type { z } from "zod";
import { uuid4 } from "@temporalio/workflow";

/**
 * Creates a tool router for declarative tool call processing.
 * Combines tool definitions with handlers in a single API.
 *
 * @example
 * ```typescript
 * const router = createToolRouter({
 *   threadId,
 *   tools: {
 *     Read: {
 *       name: "FileRead",
 *       description: "Read file contents",
 *       schema: z.object({ path: z.string() }),
 *       handler: async (args, ctx) => ({
 *         content: `Read ${args.path}`,
 *         result: { path: args.path, content: "..." },
 *       }),
 *     },
 *   },
 *   hooks: { onPreToolUse, onPostToolUse },
 * });
 *
 * // Parse raw tool calls from LLM
 * const parsed = router.parseToolCall(rawToolCall);
 *
 * // Process tool calls
 * const results = await router.processToolCalls([parsed]);
 * ```
 */
export function createToolRouter<T extends ToolMap>(
  options: ToolRouterOptions<T>
): ToolRouter<T> {
  const { appendToolResult } = options;
  type TResults = InferToolResults<T>;

  // Build internal lookup map by tool name
  const toolMap = new Map<string, ToolMap[string]>();
  for (const [_key, tool] of Object.entries(options.tools)) {
    toolMap.set(tool.name, tool as T[keyof T]);
  }

  const resolve = <T>(v: T | (() => T)): T =>
    typeof v === "function" ? (v as () => T)() : v;

  const isEnabled = (tool: ToolMap[string]): boolean =>
    resolve(tool.enabled) ?? true;

  if (options.plugins) {
    for (const plugin of options.plugins) {
      toolMap.set(plugin.name, plugin);
    }
  }

  /** Run global → per-tool pre-hooks. Returns null to skip, or the (possibly modified) args. */
  async function runPreHooks(
    toolCall: ParsedToolCallUnion<T>,
    tool: ToolMap[string] | undefined,
    turn: number
  ): Promise<{ skip: true } | { skip: false; args: unknown }> {
    let effectiveArgs: unknown = toolCall.args;

    if (options.hooks?.onPreToolUse) {
      const preResult = await options.hooks.onPreToolUse({
        toolCall,
        threadId: options.threadId,
        turn,
      });
      if (preResult?.skip) return { skip: true };
      if (preResult?.modifiedArgs !== undefined)
        effectiveArgs = preResult.modifiedArgs;
    }

    if (tool?.hooks?.onPreToolUse) {
      const preResult = await tool.hooks.onPreToolUse({
        args: effectiveArgs,
        threadId: options.threadId,
        turn,
      });
      if (preResult?.skip) return { skip: true };
      if (preResult?.modifiedArgs !== undefined)
        effectiveArgs = preResult.modifiedArgs;
    }

    return { skip: false, args: effectiveArgs };
  }

  /**
   * Run per-tool → global failure hooks. Returns recovery content/result,
   * or a generic error response if no hook recovers.
   */
  async function runFailureHooks(
    toolCall: ParsedToolCallUnion<T>,
    tool: ToolMap[string] | undefined,
    error: unknown,
    effectiveArgs: unknown,
    turn: number
  ): Promise<{ content: ToolMessageContent; result: unknown }> {
    const err = error instanceof Error ? error : new Error(String(error));
    const errorStr = String(error);

    if (tool?.hooks?.onPostToolUseFailure) {
      const r = await tool.hooks.onPostToolUseFailure({
        args: effectiveArgs,
        error: err,
        threadId: options.threadId,
        turn,
      });
      if (r?.fallbackContent !== undefined)
        return {
          content: r.fallbackContent,
          result: { error: errorStr, recovered: true },
        };
      if (r?.suppress)
        return {
          content: JSON.stringify({ error: errorStr, suppressed: true }),
          result: { error: errorStr, suppressed: true },
        };
    }

    if (options.hooks?.onPostToolUseFailure) {
      const r = await options.hooks.onPostToolUseFailure({
        toolCall,
        error: err,
        threadId: options.threadId,
        turn,
      });
      if (r?.fallbackContent !== undefined)
        return {
          content: r.fallbackContent,
          result: { error: errorStr, recovered: true },
        };
      if (r?.suppress)
        return {
          content: JSON.stringify({ error: errorStr, suppressed: true }),
          result: { error: errorStr, suppressed: true },
        };
    }

    return {
      content: JSON.stringify({
        error: "The tool encountered an error. Please try again or use a different approach.",
      }),
      result: { error: errorStr, suppressed: true },
    };
  }

  /** Run per-tool → global post-hooks. */
  async function runPostHooks(
    toolCall: ParsedToolCallUnion<T>,
    tool: ToolMap[string] | undefined,
    toolResult: ToolCallResultUnion<TResults>,
    effectiveArgs: unknown,
    turn: number,
    durationMs: number
  ): Promise<void> {
    if (tool?.hooks?.onPostToolUse) {
      await tool.hooks.onPostToolUse({
        args: effectiveArgs,
        result: toolResult.data,
        threadId: options.threadId,
        turn,
        durationMs,
        ...(toolResult.metadata && { metadata: toolResult.metadata }),
      });
    }
    if (options.hooks?.onPostToolUse) {
      await options.hooks.onPostToolUse({
        toolCall,
        result: toolResult,
        threadId: options.threadId,
        turn,
        durationMs,
      });
    }
  }

  async function processToolCall(
    toolCall: ParsedToolCallUnion<T>,
    turn: number,
    sandboxId?: string
  ): Promise<ToolCallResultUnion<TResults> | null> {
    const startTime = Date.now();
    const tool = toolMap.get(toolCall.name);

    // --- Pre-hooks: may skip or modify args ---
    const preResult = await runPreHooks(toolCall, tool, turn);
    if (preResult.skip) {
      await appendToolResult(uuid4(), {
        threadId: options.threadId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: JSON.stringify({
          skipped: true,
          reason: "Skipped by PreToolUse hook",
        }),
      });
      return null;
    }
    const effectiveArgs = preResult.args;

    // --- Execute handler ---
    let result: unknown;
    let content!: ToolMessageContent;
    let resultAppended = false;
    let metadata: Record<string, unknown> | undefined;

    try {
      if (tool) {
        const routerContext: RouterContext = {
          threadId: options.threadId,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          ...(sandboxId !== undefined && { sandboxId }),
        };
        const response = await tool.handler(
          effectiveArgs as Parameters<typeof tool.handler>[0],
          routerContext as Parameters<typeof tool.handler>[1]
        );
        result = response.data;
        content = response.toolResponse;
        resultAppended = response.resultAppended === true;
        metadata = response.metadata;
      } else {
        result = { error: `Unknown tool: ${toolCall.name}` };
        content = JSON.stringify(result, null, 2);
      }
    } catch (error) {
      const recovery = await runFailureHooks(
        toolCall,
        tool,
        error,
        effectiveArgs,
        turn
      );
      result = recovery.result;
      content = recovery.content;
    }

    // --- Append result to thread (unless handler already did) ---
    if (!resultAppended) {
      const config = {
        threadId: options.threadId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content,
      };
      await appendToolResult.executeWithOptions(
        {
          summary: `Append ${toolCall.name} result`,
        },
        [uuid4(), config]
      );
    }

    const toolResult = {
      toolCallId: toolCall.id,
      name: toolCall.name,
      data: result,
      ...(metadata && { metadata }),
    } as ToolCallResultUnion<TResults>;

    // --- Post-hooks ---
    await runPostHooks(
      toolCall,
      tool,
      toolResult,
      effectiveArgs,
      turn,
      Date.now() - startTime
    );

    return toolResult;
  }

  return {
    hasTools(): boolean {
      return Array.from(toolMap.values()).some(isEnabled);
    },

    parseToolCall(toolCall: RawToolCall): ParsedToolCallUnion<T> {
      const tool = toolMap.get(toolCall.name);

      if (!tool || !isEnabled(tool)) {
        throw new Error(`Tool ${toolCall.name} not found`);
      }

      const parsedArgs = resolve(tool.schema).parse(toolCall.args);

      return {
        id: toolCall.id ?? "",
        name: toolCall.name,
        args: parsedArgs,
      } as ParsedToolCallUnion<T>;
    },

    hasTool(name: string): boolean {
      const tool = toolMap.get(name);
      return tool !== undefined && isEnabled(tool);
    },

    getToolNames(): ToolNames<T>[] {
      return Array.from(toolMap.entries())
        .filter(([, tool]) => isEnabled(tool))
        .map(([name]) => name) as ToolNames<T>[];
    },

    getToolDefinitions(): ToolDefinition[] {
      return Array.from(toolMap)
        .filter(([, tool]) => isEnabled(tool))
        .map(([name, tool]) => ({
          name,
          description: resolve(tool.description),
          schema: resolve(tool.schema),
          strict: tool.strict,
          max_uses: tool.max_uses,
        }));
    },

    async processToolCalls(
      toolCalls: ParsedToolCallUnion<T>[],
      context?: ProcessToolCallsContext
    ): Promise<ToolCallResultUnion<TResults>[]> {
      if (toolCalls.length === 0) {
        return [];
      }

      const turn = context?.turn ?? 0;
      const sandboxId = context?.sandboxId;

      if (options.parallel) {
        const results = await Promise.all(
          toolCalls.map((tc) => processToolCall(tc, turn, sandboxId))
        );
        return results.filter(
          (r): r is NonNullable<typeof r> => r !== null
        ) as ToolCallResultUnion<TResults>[];
      }

      const results: ToolCallResultUnion<TResults>[] = [];
      for (const toolCall of toolCalls) {
        const result = await processToolCall(toolCall, turn, sandboxId);
        if (result !== null) {
          results.push(result);
        }
      }
      return results;
    },

    async processToolCallsByName<TName extends ToolNames<T>, TResult>(
      toolCalls: ParsedToolCallUnion<T>[],
      toolName: TName,
      handler: ToolHandler<ToolArgs<T, TName>, TResult>,
      context?: ProcessToolCallsContext
    ): Promise<ToolCallResult<TName, TResult>[]> {
      const matchingCalls = toolCalls.filter((tc) => tc.name === toolName);

      if (matchingCalls.length === 0) {
        return [];
      }

      const processOne = async (
        toolCall: ParsedToolCallUnion<T>
      ): Promise<ToolCallResult<TName, TResult>> => {
        const routerContext: RouterContext = {
          threadId: options.threadId,
          toolCallId: toolCall.id,
          toolName: toolCall.name as TName,
          ...(context?.sandboxId !== undefined && {
            sandboxId: context.sandboxId,
          }),
        };
        const response = await handler(
          toolCall.args as ToolArgs<T, TName>,
          routerContext as Parameters<typeof handler>[1]
        );

        if (!response.resultAppended) {
          await appendToolResult.executeWithOptions(
            {
              summary: `Append ${toolCall.name} result`,
            },
            [
              uuid4(),
              {
                threadId: options.threadId,
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                content: response.toolResponse,
              },
            ]
          );
        }

        return {
          toolCallId: toolCall.id,
          name: toolCall.name as TName,
          data: response.data,
          ...(response.metadata && { metadata: response.metadata }),
        };
      };

      if (options.parallel) {
        return Promise.all(matchingCalls.map(processOne));
      }

      const results: ToolCallResult<TName, TResult>[] = [];
      for (const toolCall of matchingCalls) {
        results.push(await processOne(toolCall));
      }
      return results;
    },

    filterByName<TName extends ToolNames<T>>(
      toolCalls: ParsedToolCallUnion<T>[],
      name: TName
    ): ParsedToolCall<TName, ToolArgs<T, TName>>[] {
      return toolCalls.filter(
        (tc): tc is ParsedToolCall<TName, ToolArgs<T, TName>> =>
          tc.name === name
      );
    },

    hasToolCall(
      toolCalls: ParsedToolCallUnion<T>[],
      name: ToolNames<T>
    ): boolean {
      return toolCalls.some((tc) => tc.name === name);
    },

    getResultsByName<TName extends ToolNames<T>>(
      results: ToolCallResultUnion<TResults>[],
      name: TName
    ): ToolCallResult<TName, ToolResult<T, TName>>[] {
      return results.filter((r) => r.name === name) as ToolCallResult<
        TName,
        ToolResult<T, TName>
      >[];
    },
  };
}

/**
 * Identity function that creates a generic inference context for a tool definition.
 * TypeScript infers TResult from the handler and flows it to hooks automatically.
 *
 * @example
 * ```typescript
 * tools: {
 *   AskUser: defineTool({
 *     ...askUserTool,
 *     handler: handleAskUser,
 *     hooks: {
 *       onPostToolUse: ({ result }) => {
 *         // result is correctly typed as the handler's return data type
 *       },
 *     },
 *   }),
 * }
 * ```
 */
export function defineTool<
  TName extends string,
  TSchema extends z.ZodType,
  TResult,
  TContext extends RouterContext = RouterContext,
>(
  tool: ToolWithHandler<TName, TSchema, TResult, TContext>
): ToolWithHandler<TName, TSchema, TResult, TContext> {
  return tool;
}

/**
 * Utility to check if there were no tool calls besides a specific one
 */
export function hasNoOtherToolCalls<T extends ToolMap>(
  toolCalls: ParsedToolCallUnion<T>[],
  excludeName: ToolNames<T>
): boolean {
  return toolCalls.filter((tc) => tc.name !== excludeName).length === 0;
}
