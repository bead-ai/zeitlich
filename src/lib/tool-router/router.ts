import type { ToolMessageContent } from "../types";
import type {
  ToolMap,
  ToolDefinition,
  ToolHandlerContext,
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
import { ApplicationFailure } from "@temporalio/workflow";

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

  /** Check if a tool is enabled (defaults to true when not specified) */
  const isEnabled = (tool: ToolMap[string]): boolean => tool.enabled ?? true;

  if (options.plugins) {
    for (const plugin of options.plugins) {
      toolMap.set(plugin.name, plugin);
    }
  }

  async function processToolCall(
    toolCall: ParsedToolCallUnion<T>,
    turn: number,
    handlerContext?: ToolHandlerContext,
    sandboxId?: string
  ): Promise<ToolCallResultUnion<TResults> | null> {
    const startTime = Date.now();
    const tool = toolMap.get(toolCall.name);
    const toolHooks = tool?.hooks;

    // --- PreToolUse: global then per-tool ---
    let effectiveArgs: unknown = toolCall.args;
    if (options.hooks?.onPreToolUse) {
      const preResult = await options.hooks.onPreToolUse({
        toolCall,
        threadId: options.threadId,
        turn,
      });
      if (preResult?.skip) {
        await appendToolResult({
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
      if (preResult?.modifiedArgs !== undefined) {
        effectiveArgs = preResult.modifiedArgs;
      }
    }
    if (toolHooks?.onPreToolUse) {
      const preResult = await toolHooks.onPreToolUse({
        args: effectiveArgs,
        threadId: options.threadId,
        turn,
      });
      if (preResult?.skip) {
        await appendToolResult({
          threadId: options.threadId,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: JSON.stringify({
            skipped: true,
            reason: "Skipped by tool PreToolUse hook",
          }),
        });
        return null;
      }
      if (preResult?.modifiedArgs !== undefined) {
        effectiveArgs = preResult.modifiedArgs;
      }
    }

    // --- Execute handler ---
    let result: unknown;
    let content!: ToolMessageContent;
    let resultAppended = false;

    try {
      if (tool) {
        const enrichedContext = {
          ...(handlerContext ?? {}),
          threadId: options.threadId,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          ...(sandboxId !== undefined && { sandboxId }),
        };
        const response = await tool.handler(
          effectiveArgs as Parameters<typeof tool.handler>[0],
          enrichedContext as Parameters<typeof tool.handler>[1]
        );
        result = response.data;
        content = response.toolResponse;
        resultAppended = response.resultAppended === true;
      } else {
        result = { error: `Unknown tool: ${toolCall.name}` };
        content = JSON.stringify(result, null, 2);
      }
    } catch (error) {
      // --- PostToolUseFailure: per-tool then global ---
      const err = error instanceof Error ? error : new Error(String(error));
      let recovered = false;

      if (toolHooks?.onPostToolUseFailure) {
        const failureResult = await toolHooks.onPostToolUseFailure({
          args: effectiveArgs,
          error: err,
          threadId: options.threadId,
          turn,
        });
        if (failureResult?.fallbackContent !== undefined) {
          content = failureResult.fallbackContent;
          result = { error: String(error), recovered: true };
          recovered = true;
        } else if (failureResult?.suppress) {
          content = JSON.stringify({ error: String(error), suppressed: true });
          result = { error: String(error), suppressed: true };
          recovered = true;
        }
      }

      if (!recovered && options.hooks?.onPostToolUseFailure) {
        const failureResult = await options.hooks.onPostToolUseFailure({
          toolCall,
          error: err,
          threadId: options.threadId,
          turn,
        });
        if (failureResult?.fallbackContent !== undefined) {
          content = failureResult.fallbackContent;
          result = { error: String(error), recovered: true };
          recovered = true;
        } else if (failureResult?.suppress) {
          content = JSON.stringify({ error: String(error), suppressed: true });
          result = { error: String(error), suppressed: true };
          recovered = true;
        }
      }

      if (!recovered) {
        throw ApplicationFailure.fromError(error, {
          nonRetryable: true,
        });
      }
    }

    // Automatically append tool result to thread (unless handler already did)
    if (!resultAppended) {
      await appendToolResult({
        threadId: options.threadId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content,
      });
    }

    const toolResult = {
      toolCallId: toolCall.id,
      name: toolCall.name,
      data: result,
    } as ToolCallResultUnion<TResults>;

    // --- PostToolUse: per-tool then global ---
    const durationMs = Date.now() - startTime;
    if (toolHooks?.onPostToolUse) {
      await toolHooks.onPostToolUse({
        args: effectiveArgs,
        result: result,
        threadId: options.threadId,
        turn,
        durationMs,
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

      const parsedArgs = tool.schema.parse(toolCall.args);

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
          description: tool.description,
          schema: tool.schema,
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
      const handlerContext = context?.handlerContext;
      const sandboxId = context?.sandboxId;

      if (options.parallel) {
        const results = await Promise.all(
          toolCalls.map((tc) =>
            processToolCall(tc, turn, handlerContext, sandboxId)
          )
        );
        return results.filter(
          (r): r is NonNullable<typeof r> => r !== null
        ) as ToolCallResultUnion<TResults>[];
      }

      const results: ToolCallResultUnion<TResults>[] = [];
      for (const toolCall of toolCalls) {
        const result = await processToolCall(
          toolCall,
          turn,
          handlerContext,
          sandboxId
        );
        if (result !== null) {
          results.push(result);
        }
      }
      return results;
    },

    async processToolCallsByName<
      TName extends ToolNames<T>,
      TResult,
      TContext = ToolHandlerContext,
    >(
      toolCalls: ParsedToolCallUnion<T>[],
      toolName: TName,
      handler: ToolHandler<ToolArgs<T, TName>, TResult, TContext>,
      context?: ProcessToolCallsContext<TContext>
    ): Promise<ToolCallResult<TName, TResult>[]> {
      const matchingCalls = toolCalls.filter((tc) => tc.name === toolName);

      if (matchingCalls.length === 0) {
        return [];
      }

      const handlerContext = (context?.handlerContext ?? {}) as TContext;

      const processOne = async (
        toolCall: ParsedToolCallUnion<T>
      ): Promise<ToolCallResult<TName, TResult>> => {
        const enrichedContext = {
          ...(handlerContext ?? {}),
          threadId: options.threadId,
          toolCallId: toolCall.id,
          toolName: toolCall.name as TName,
        } as TContext;
        const response = await handler(
          toolCall.args as ToolArgs<T, TName>,
          enrichedContext
        );

        if (!response.resultAppended) {
          await appendToolResult({
            threadId: options.threadId,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: response.toolResponse,
          });
        }

        return {
          toolCallId: toolCall.id,
          name: toolCall.name as TName,
          data: response.data,
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
  TContext = ToolHandlerContext,
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
