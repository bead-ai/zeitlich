import type {
  MessageStructure,
  MessageToolDefinition,
} from "@langchain/core/messages";
import type { ToolMessageContent } from "./thread-manager";
import type {
  ToolResultConfig,
  PreToolUseHook,
  PostToolUseHook,
  PostToolUseFailureHook,
} from "./types";

import type { z } from "zod";

export type { ToolMessageContent };

// ============================================================================
// Tool Definition Types (merged from tool-registry.ts)
// ============================================================================

/**
 * A tool definition with a name, description, and Zod schema for arguments.
 * Does not include a handler - use ToolWithHandler for tools with handlers.
 */
export interface ToolDefinition<
  TName extends string = string,
  TSchema extends z.ZodType = z.ZodType,
> {
  name: TName;
  description: string;
  schema: TSchema;
  strict?: boolean;
  max_uses?: number;
}

/**
 * A tool definition with an integrated handler function.
 * This is the primary type for defining tools in the router.
 */
export interface ToolWithHandler<
  TName extends string = string,
  TSchema extends z.ZodType = z.ZodType,
  TResult = unknown,
  TContext = ToolHandlerContext,
> {
  name: TName;
  description: string;
  schema: TSchema;
  handler: ToolHandler<z.infer<TSchema>, TResult, TContext>;
  strict?: boolean;
  max_uses?: number;
}

/**
 * A map of tool keys to tool definitions with handlers.
 */
export type ToolMap = Record<string, ToolWithHandler>;

/**
 * Converts a ToolMap to MessageStructure-compatible tools type.
 * Maps each tool's name to a MessageToolDefinition with inferred input type from the schema.
 */
export type ToolMapToMessageTools<T extends ToolMap> = {
  [K in keyof T as T[K]["name"]]: MessageToolDefinition<
    z.infer<T[K]["schema"]>
  >;
};

/**
 * Creates a MessageStructure type from a ToolMap.
 * This allows typed tool_calls on AIMessage when using parseToolCalls.
 */
export type ToolMapToMessageStructure<T extends ToolMap> = MessageStructure<
  ToolMapToMessageTools<T>
>;

/**
 * Extract the tool names from a tool map (uses the tool's name property, not the key).
 */
export type ToolNames<T extends ToolMap> = T[keyof T]["name"];

/**
 * A raw tool call as received from the LLM before parsing.
 */
export interface RawToolCall {
  id?: string;
  name: string;
  args: unknown;
}

/**
 * A parsed tool call with validated arguments for a specific tool.
 */
export interface ParsedToolCall<
  TName extends string = string,
  TArgs = unknown,
> {
  id: string;
  name: TName;
  args: TArgs;
}

/**
 * Union type of all possible parsed tool calls from a tool map.
 */
export type ParsedToolCallUnion<T extends ToolMap> = {
  [K in keyof T]: ParsedToolCall<T[K]["name"], z.infer<T[K]["schema"]>>;
}[keyof T];

// ============================================================================
// Handler Types
// ============================================================================

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
 * Receives the parsed args and context, returns a response with content and result.
 * Context always has a value (defaults to empty object if not provided).
 */
export type ToolHandler<TArgs, TResult, TContext = ToolHandlerContext> = (
  args: TArgs,
  context: TContext
) => ToolHandlerResponse<TResult> | Promise<ToolHandlerResponse<TResult>>;

/**
 * Activity-compatible tool handler that always returns a Promise.
 * Use this for tool handlers registered as Temporal activities.
 * Context always has a value (defaults to empty object if not provided).
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
> = (args: TArgs, context: TContext) => Promise<ToolHandlerResponse<TResult>>;

/**
 * Extract the args type for a specific tool name from a tool map.
 */
export type ToolArgs<T extends ToolMap, TName extends ToolNames<T>> = z.infer<
  Extract<T[keyof T], { name: TName }>["schema"]
>;

/**
 * Extract the result type for a specific tool name from a tool map.
 */
export type ToolResult<T extends ToolMap, TName extends ToolNames<T>> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Extract<T[keyof T], { name: TName }>["handler"] extends ToolHandler<any, infer R, any>
    ? Awaited<R>
    : never;

// ============================================================================
// Tool Call Result Types
// ============================================================================

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
 * Infer result types from a tool map based on handler return types.
 */
export type InferToolResults<T extends ToolMap> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof T as T[K]["name"]]: T[K]["handler"] extends ToolHandler<any, infer R, any>
    ? Awaited<R>
    : never;
};

/**
 * Union of all possible tool call results based on handler return types.
 */
export type ToolCallResultUnion<TResults extends Record<string, unknown>> = {
  [TName in keyof TResults & string]: ToolCallResult<TName, TResults[TName]>;
}[keyof TResults & string];

// ============================================================================
// Router Configuration Types
// ============================================================================

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
 * Options for creating a tool router.
 */
export interface ToolRouterOptions<T extends ToolMap> {
  /** Map of tools with their handlers */
  tools: T;
  /** Thread ID for appending tool results */
  threadId: string;
  /** Function to append tool results to the thread (called automatically after each handler) */
  appendToolResult: AppendToolResultFn;
  /** Whether to process tools in parallel (default: true) */
  parallel?: boolean;
  /** Lifecycle hooks for tool execution */
  hooks?: ToolRouterHooks<T, ToolCallResultUnion<InferToolResults<T>>>;
}

/**
 * Context passed to processToolCalls for hook execution and handler invocation
 */
export interface ProcessToolCallsContext<THandlerContext = ToolHandlerContext> {
  /** Current turn number (for hooks) */
  turn?: number;
  /** Context passed to each tool handler (scopedNodes, provider, etc.) */
  handlerContext?: THandlerContext;
}

// ============================================================================
// Router Interface
// ============================================================================

/**
 * The tool router interface with full type inference for both args and results.
 */
export interface ToolRouter<T extends ToolMap> {
  // --- Methods from registry ---

  /**
   * Parse and validate a raw tool call against the router's tools.
   * Returns a typed tool call with validated arguments.
   */
  parseToolCall(toolCall: RawToolCall): ParsedToolCallUnion<T>;

  /**
   * Check if a tool with the given name exists in the router.
   */
  hasTool(name: string): boolean;

  /**
   * Get all tool names in the router.
   */
  getToolNames(): ToolNames<T>[];

  /**
   * Get all tool definitions (without handlers) for passing to LLM.
   */
  getToolDefinitions(): ToolDefinition[];

  // --- Methods for processing tool calls ---

  /**
   * Process all tool calls using the registered handlers.
   * Returns typed results based on handler return types.
   * @param toolCalls - Array of parsed tool calls to process
   * @param context - Optional context including turn number for hooks
   */
  processToolCalls(
    toolCalls: ParsedToolCallUnion<T>[],
    context?: ProcessToolCallsContext
  ): Promise<ToolCallResultUnion<InferToolResults<T>>[]>;

  /**
   * Process tool calls matching a specific name with a custom handler.
   * Useful for overriding the default handler for specific cases.
   */
  processToolCallsByName<
    TName extends ToolNames<T>,
    TResult,
    TContext = ToolHandlerContext,
  >(
    toolCalls: ParsedToolCallUnion<T>[],
    toolName: TName,
    handler: ToolHandler<ToolArgs<T, TName>, TResult, TContext>,
    context?: ProcessToolCallsContext<TContext>
  ): Promise<ToolCallResult<TName, TResult>[]>;

  // --- Utility methods ---

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
  getResultsByName<TName extends ToolNames<T>>(
    results: ToolCallResultUnion<InferToolResults<T>>[],
    name: TName
  ): ToolCallResult<TName, ToolResult<T, TName>>[];
}

// ============================================================================
// Router Factory
// ============================================================================

/**
 * Creates a tool router for declarative tool call processing.
 * Combines tool definitions with handlers in a single API.
 *
 * @example
 * ```typescript
 * const router = createToolRouter({
 *   threadId,
 *   appendToolResult,
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
  const { tools, parallel = true, threadId, appendToolResult, hooks } = options;

  type TResults = InferToolResults<T>;

  // Build internal lookup map by tool name
  const toolMap = new Map<string, T[keyof T]>();
  for (const [_key, tool] of Object.entries(tools)) {
    toolMap.set(tool.name, tool as T[keyof T]);
  }

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

    const tool = toolMap.get(toolCall.name);
    let result: unknown;
    let content: ToolMessageContent;

    try {
      if (tool) {
        const response = await tool.handler(
          effectiveArgs as Parameters<typeof tool.handler>[0],
          (handlerContext ?? {}) as Parameters<typeof tool.handler>[1]
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
    // --- Methods from registry ---

    parseToolCall(toolCall: RawToolCall): ParsedToolCallUnion<T> {
      const tool = toolMap.get(toolCall.name);

      if (!tool) {
        throw new Error(`Tool ${toolCall.name} not found`);
      }

      // Parse and validate args using the tool's schema
      const parsedArgs = tool.schema.parse(toolCall.args);

      return {
        id: toolCall.id ?? "",
        name: toolCall.name,
        args: parsedArgs,
      } as ParsedToolCallUnion<T>;
    },

    hasTool(name: string): boolean {
      return toolMap.has(name);
    },

    getToolNames(): ToolNames<T>[] {
      return Array.from(toolMap.keys()) as ToolNames<T>[];
    },

    getToolDefinitions(): ToolDefinition[] {
      return Object.values(tools).map((tool) => ({
        name: tool.name,
        description: tool.description,
        schema: tool.schema,
        strict: tool.strict,
        max_uses: tool.max_uses,
      }));
    },

    // --- Methods for processing tool calls ---

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
        const response = await handler(
          toolCall.args as ToolArgs<T, TName>,
          handlerContext
        );

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

    // --- Utility methods ---

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
 * Utility to check if there were no tool calls besides a specific one
 */
export function hasNoOtherToolCalls<T extends ToolMap>(
  toolCalls: ParsedToolCallUnion<T>[],
  excludeName: ToolNames<T>
): boolean {
  return toolCalls.filter((tc) => tc.name !== excludeName).length === 0;
}
