import type { ToolMessageContent } from "./thread-manager";
import type {
  ParsedToolCall,
  ParsedToolCallUnion,
  ToolMap,
  ToolNames,
  ToolRegistry,
} from "./tool-registry";
import type {
  ToolResultConfig,
  PreToolUseHook,
  PostToolUseHook,
  PostToolUseFailureHook,
} from "./types";

import type { z } from "zod";

export type { ToolMessageContent };

/**
 * Function signature for appending tool results to a thread.
 */
export type AppendToolResultFn = (config: ToolResultConfig) => Promise<void>;

/**
 * The response from a tool handler.
 * Contains the content for the tool message and the result to return from processToolCalls.
 */
export interface ToolHandlerResponse<TResult> {
  /** Content for the tool message added to the thread */
  content: ToolMessageContent;
  /** Result returned from processToolCalls */
  result: TResult;
}

/**
 * Context passed to tool handlers for additional data beyond tool args.
 * Use this to pass workflow state like file trees, user context, etc.
 */
export interface ToolHandlerContext {
  /** Additional context data - define your own shape */
  [key: string]: unknown;
}

/**
 * A handler function for a specific tool.
 * Receives the parsed args and optional context, returns a response with content and result.
 */
export type ToolHandler<TArgs, TResult, TContext = ToolHandlerContext> = (
  args: TArgs,
  context?: TContext
) => ToolHandlerResponse<TResult> | Promise<ToolHandlerResponse<TResult>>;

/**
 * Activity-compatible tool handler that always returns a Promise.
 * Use this for tool handlers registered as Temporal activities.
 *
 * @example
 * ```typescript
 * // Filesystem handler with context
 * const readHandler: ActivityToolHandler<
 *   ReadToolSchemaType,
 *   ReadResult,
 *   { scopedNodes: FileNode[]; provider: FileSystemProvider }
 * > = async (args, context) => {
 *   return readHandler(args, context.scopedNodes, context.provider);
 * };
 * ```
 */
export type ActivityToolHandler<
  TArgs,
  TResult,
  TContext = ToolHandlerContext,
> = (args: TArgs, context?: TContext) => Promise<ToolHandlerResponse<TResult>>;

/**
 * Extract the args type for a specific tool name from a tool map.
 */
export type ToolArgs<T extends ToolMap, TName extends ToolNames<T>> = z.infer<
  Extract<T[keyof T], { name: TName }>["schema"]
>;

/**
 * A map of tool handlers keyed by tool name with typed results.
 * Each handler receives the properly typed args for that tool.
 */
export type ToolHandlerMap<
  T extends ToolMap,
  TResults extends Record<ToolNames<T>, unknown>,
> = {
  [TName in ToolNames<T>]: ToolHandler<ToolArgs<T, TName>, TResults[TName]>;
};

/**
 * Extract the ToolMap type from a ToolRegistry instance type.
 */
export type InferToolMap<T> = T extends ToolRegistry<infer U> ? U : never;

/**
 * The result of processing a tool call.
 */
export interface ToolCallResult<
  TName extends string = string,
  TResult = unknown,
> {
  toolCallId: string;
  name: TName;
  result: TResult;
}

/**
 * Union of all possible tool call results based on handler return types.
 */
export type ToolCallResultUnion<TResults extends Record<string, unknown>> = {
  [TName in keyof TResults & string]: ToolCallResult<TName, TResults[TName]>;
}[keyof TResults & string];

/**
 * Tool-specific hooks for the router
 */
export interface ToolRouterHooks<T extends ToolMap, TResult = unknown> {
  /** Called before each tool execution - can block or modify */
  onPreToolUse?: PreToolUseHook<T>;
  /** Called after each successful tool execution */
  onPostToolUse?: PostToolUseHook<T, TResult>;
  /** Called when tool execution fails */
  onPostToolUseFailure?: PostToolUseFailureHook<T>;
}

/**
 * Options for tool router.
 */
export interface ToolRouterOptions<T extends ToolMap, TResult = unknown> {
  /** Tool registry - used for type inference */
  registry: ToolRegistry<T>;
  /** Thread ID for appending tool results */
  threadId: string;
  /** Function to append tool results to the thread (called automatically after each handler) */
  appendToolResult: AppendToolResultFn;
  /** Whether to process tools in parallel (default: true) */
  parallel?: boolean;
  /** Lifecycle hooks for tool execution */
  hooks?: ToolRouterHooks<T, TResult>;
}

/**
 * Context passed to processToolCalls for hook execution and handler invocation
 */
export interface ProcessToolCallsContext<
  THandlerContext = ToolHandlerContext,
> {
  /** Current turn number (for hooks) */
  turn?: number;
  /** Context passed to each tool handler (scopedNodes, provider, etc.) */
  handlerContext?: THandlerContext;
}

/**
 * The tool router interface with full type inference for both args and results.
 */
export interface ToolRouter<
  T extends ToolMap,
  TResults extends Record<string, unknown>,
> {
  /**
   * Process all tool calls using the registered handlers.
   * Returns typed results based on handler return types.
   * @param toolCalls - Array of parsed tool calls to process
   * @param context - Optional context including turn number for hooks
   */
  processToolCalls(
    toolCalls: ParsedToolCallUnion<T>[],
    context?: ProcessToolCallsContext
  ): Promise<ToolCallResultUnion<TResults>[]>;

  /**
   * Process tool calls matching a specific name with a custom handler.
   */
  processToolCallsByName<TName extends ToolNames<T>, TResult>(
    toolCalls: ParsedToolCallUnion<T>[],
    toolName: TName,
    handler: ToolHandler<ToolArgs<T, TName>, TResult>
  ): Promise<ToolCallResult<TName, TResult>[]>;

  /**
   * Filter tool calls by name.
   */
  filterByName<TName extends ToolNames<T>>(
    toolCalls: ParsedToolCallUnion<T>[],
    name: TName
  ): ParsedToolCall<TName, ToolArgs<T, TName>>[];

  /**
   * Check if any tool call matches the given name.
   */
  hasToolCall(toolCalls: ParsedToolCallUnion<T>[], name: ToolNames<T>): boolean;

  /**
   * Filter results by tool name.
   */
  getResultsByName<TName extends ToolNames<T> & keyof TResults>(
    results: ToolCallResultUnion<TResults>[],
    name: TName
  ): ToolCallResult<TName, TResults[TName]>[];
}

/**
 * Infer result types from a handler map.
 * Uses `any` for args due to function contravariance - handlers with specific
 * args types won't extend ToolHandler<unknown, R>.
 */
export type InferHandlerResults<H> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof H & string]: H[K] extends ToolHandler<any, infer R>
    ? Awaited<R>
    : never;
};

/**
 * Creates a tool router for declarative tool call processing.
 * ToolMap type is inferred from options.registry, result types from handlers.
 *
 * @example
 * const router = createToolRouter(
 *   {
 *     registry: controlTestToolRegistry,
 *     threadId,
 *     appendToolResult,
 *     hooks: {
 *       onPreToolUse: (ctx) => { console.log('Before:', ctx.toolCall.name); },
 *       onPostToolUse: (ctx) => { console.log('After:', ctx.toolCall.name, ctx.durationMs); },
 *     },
 *   },
 *   {
 *     AskUserQuestion: async (args, toolCallId) => ({ content: '...', result: {...} }),
 *     // ... other handlers
 *   },
 * );
 *
 * const results = await router.processToolCalls(toolCalls, { turn: 1 });
 * // results[0].result is typed based on handler return types
 */
export function createToolRouter<
  T extends ToolMap,
  THandlers extends {
    [TName in ToolNames<T>]: ToolHandler<ToolArgs<T, TName>, unknown>;
  },
>(
  options: ToolRouterOptions<
    T,
    ToolCallResultUnion<InferHandlerResults<THandlers>>
  >,
  handlers: THandlers
): ToolRouter<T, InferHandlerResults<THandlers>> {
  const { parallel = true, threadId, appendToolResult, hooks } = options;

  type TResults = InferHandlerResults<THandlers>;

  async function processToolCall(
    toolCall: ParsedToolCallUnion<T>,
    turn: number,
    handlerContext?: ToolHandlerContext
  ): Promise<ToolCallResultUnion<TResults> | null> {
    const startTime = Date.now();

    // PreToolUse hook - can skip or modify args
    let effectiveArgs: unknown = toolCall.args;
    if (hooks?.onPreToolUse) {
      const preResult = await hooks.onPreToolUse({
        toolCall,
        threadId,
        turn,
      });
      if (preResult?.skip) {
        // Skip this tool call - append a skip message and return null
        await appendToolResult({
          threadId,
          toolCallId: toolCall.id,
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

    const handler = handlers[toolCall.name as keyof THandlers];
    let result: unknown;
    let content: ToolMessageContent;

    try {
      if (handler) {
        // Use effective args (potentially modified by PreToolUse hook)
        // Cast is safe: either original args or modified args that must match schema
        const response = await handler(
          effectiveArgs as Parameters<typeof handler>[0],
          handlerContext
        );
        result = response.result;
        content = response.content;
      } else {
        result = { error: `Unknown tool: ${toolCall.name}` };
        content = JSON.stringify(result, null, 2);
      }
    } catch (error) {
      // PostToolUseFailure hook - can recover from errors
      if (hooks?.onPostToolUseFailure) {
        const failureResult = await hooks.onPostToolUseFailure({
          toolCall,
          error: error instanceof Error ? error : new Error(String(error)),
          threadId,
          turn,
        });
        if (failureResult?.fallbackContent !== undefined) {
          content = failureResult.fallbackContent;
          result = { error: String(error), recovered: true };
        } else if (failureResult?.suppress) {
          content = JSON.stringify({ error: String(error), suppressed: true });
          result = { error: String(error), suppressed: true };
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    // Automatically append tool result to thread
    await appendToolResult({ threadId, toolCallId: toolCall.id, content });

    const toolResult = {
      toolCallId: toolCall.id,
      name: toolCall.name,
      result,
    } as ToolCallResultUnion<TResults>;

    // PostToolUse hook - called after successful execution
    if (hooks?.onPostToolUse) {
      const durationMs = Date.now() - startTime;
      await hooks.onPostToolUse({
        toolCall,
        result: toolResult,
        threadId,
        turn,
        durationMs,
      });
    }

    return toolResult;
  }

  return {
    async processToolCalls(
      toolCalls: ParsedToolCallUnion<T>[],
      context?: ProcessToolCallsContext
    ): Promise<ToolCallResultUnion<TResults>[]> {
      if (toolCalls.length === 0) {
        return [];
      }

      const turn = context?.turn ?? 0;
      const handlerContext = context?.handlerContext;

      if (parallel) {
        const results = await Promise.all(
          toolCalls.map((tc) => processToolCall(tc, turn, handlerContext))
        );
        // Filter out null results (skipped tool calls)
        return results.filter(
          (r): r is NonNullable<typeof r> => r !== null
        ) as ToolCallResultUnion<TResults>[];
      }

      // Sequential processing
      const results: ToolCallResultUnion<TResults>[] = [];
      for (const toolCall of toolCalls) {
        const result = await processToolCall(toolCall, turn, handlerContext);
        if (result !== null) {
          results.push(result);
        }
      }
      return results;
    },

    async processToolCallsByName<TName extends ToolNames<T>, TResult>(
      toolCalls: ParsedToolCallUnion<T>[],
      toolName: TName,
      handler: ToolHandler<ToolArgs<T, TName>, TResult>
    ): Promise<ToolCallResult<TName, TResult>[]> {
      const matchingCalls = toolCalls.filter((tc) => tc.name === toolName);

      if (matchingCalls.length === 0) {
        return [];
      }

      const processOne = async (
        toolCall: ParsedToolCallUnion<T>
      ): Promise<ToolCallResult<TName, TResult>> => {
        const response = await handler(toolCall.args as ToolArgs<T, TName>);

        // Automatically append tool result to thread
        await appendToolResult({
          threadId,
          toolCallId: toolCall.id,
          content: response.content,
        });

        return {
          toolCallId: toolCall.id,
          name: toolCall.name as TName,
          result: response.result,
        };
      };

      if (parallel) {
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

    getResultsByName<TName extends ToolNames<T> & keyof TResults>(
      results: ToolCallResultUnion<TResults>[],
      name: TName
    ): ToolCallResult<TName, TResults[TName]>[] {
      return results.filter(
        (r): r is ToolCallResult<TName, TResults[TName]> => r.name === name
      );
    },
  };
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
