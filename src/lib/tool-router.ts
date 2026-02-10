import type { MessageToolDefinition } from "@langchain/core/messages";
import type { ToolMessageContent } from "./thread-manager";
import type {
  Hooks,
  PostToolUseFailureHookResult,
  PreToolUseHookResult,
  SubagentConfig,
  SubagentHooks,
  ToolHooks,
  ToolResultConfig,
} from "./types";
import type { GenericTaskToolSchemaType } from "../tools/task/tool";

import type { z } from "zod";
import { proxyActivities } from "@temporalio/workflow";
import type { ZeitlichSharedActivities } from "../activities";
import { createTaskTool } from "../tools/task/tool";
import { createTaskHandler } from "../tools/task/handler";
import { bashTool, createBashToolDescription } from "../tools/bash/tool";

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
  /** Per-tool lifecycle hooks (run in addition to global hooks) */
  hooks?: ToolHooks<z.infer<TSchema>, TResult>;
}

/**
 * A map of tool keys to tool definitions with handlers.
 */
export type ToolMap = Record<
  string,
  {
    name: string;
    description: string;
    schema: z.ZodType;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    handler: (
      args: any,
      context: any
    ) => ToolHandlerResponse<any> | Promise<ToolHandlerResponse<any>>;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    strict?: boolean;
    max_uses?: number;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    hooks?: ToolHooks<any, any>;
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }
>;

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
  /** Content sent back to the LLM as the tool call response */
  toolResponse: ToolMessageContent;
  /** Data returned to the workflow and hooks for further processing */
  data: TResult | null;
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
  Extract<T[keyof T], { name: TName }>["handler"] extends ToolHandler<
    unknown,
    infer R,
    unknown
  >
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
  data: TResult | null;
}

/**
 * Options for creating a tool router.
 */
export interface ToolRouterOptions<T extends ToolMap> {
  /** File tree for the agent */
  fileTree: string;
  /** Map of tools with their handlers */
  tools: T;
  /** Thread ID for appending tool results */
  threadId: string;
  /** Function to append tool results to the thread (called automatically after each handler) */
  appendToolResult: AppendToolResultFn;
  /** Whether to process tools in parallel (default: true) */
  parallel?: boolean;
  /** Lifecycle hooks for tool execution */
  hooks?: Hooks<T, ToolCallResultUnion<InferToolResults<T>>>;
  /** Subagent configurations */
  subagents?: SubagentConfig[];
}

/**
 * Infer result types from a tool map based on handler return types.
 */
export type InferToolResults<T extends ToolMap> = {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  [K in keyof T as T[K]["name"]]: T[K]["handler"] extends ToolHandler<
    any,
    infer R,
    any
  >
    ? /* eslint-enable @typescript-eslint/no-explicit-any */
      Awaited<R>
    : never;
};

/**
 * Union of all possible tool call results based on handler return types.
 */
export type ToolCallResultUnion<TResults extends Record<string, unknown>> = {
  [TName in keyof TResults & string]: ToolCallResult<TName, TResults[TName]>;
}[keyof TResults & string];

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
  /** Check if the router has any tools */
  hasTools(): boolean;
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
  const { appendToolResult } = proxyActivities<ZeitlichSharedActivities>({
    startToCloseTimeout: "2m",
    retry: {
      maximumAttempts: 3,
      initialInterval: "5s",
      maximumInterval: "15m",
      backoffCoefficient: 4,
    },
  });
  type TResults = InferToolResults<T>;

  // Build internal lookup map by tool name
  // Use ToolMap's value type to allow both user tools and the dynamic Task tool
  const toolMap = new Map<string, ToolMap[string]>();
  for (const [_key, tool] of Object.entries(options.tools)) {
    // Enhance Bash tool description with file tree when available
    if (tool.name === bashTool.name && options.fileTree) {
      toolMap.set(tool.name, {
        ...tool,
        description: createBashToolDescription({ fileTree: options.fileTree }),
      } as T[keyof T]);
    } else {
      toolMap.set(tool.name, tool as T[keyof T]);
    }
  }

  if (options.subagents) {
    // Build per-subagent hook dispatcher keyed by subagent name
    const subagentHooksMap = new Map<string, SubagentHooks>();
    for (const s of options.subagents) {
      if (s.hooks) subagentHooksMap.set(s.name, s.hooks);
    }

    const resolveSubagentName = (args: unknown): string =>
      (args as GenericTaskToolSchemaType).subagent;

    toolMap.set("Task", {
      ...createTaskTool(options.subagents),
      handler: createTaskHandler(options.subagents),
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
    });
  }

  async function processToolCall(
    toolCall: ParsedToolCallUnion<T>,
    turn: number,
    handlerContext?: ToolHandlerContext
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

    try {
      if (tool) {
        const response = await tool.handler(
          effectiveArgs as Parameters<typeof tool.handler>[0],
          (handlerContext ?? {}) as Parameters<typeof tool.handler>[1]
        );
        result = response.data;
        content = response.toolResponse;
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
        throw error;
      }
    }

    // Automatically append tool result to thread
    await appendToolResult({
      threadId: options.threadId,
      toolCallId: toolCall.id,
      content,
    });

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
    // --- Methods from registry ---

    hasTools(): boolean {
      return toolMap.size > 0;
    },

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
      return Array.from(toolMap).map(([name, tool]) => ({
        name,
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

      if (options.parallel) {
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
          threadId: options.threadId,
          toolCallId: toolCall.id,
          content: response.toolResponse,
        });

        return {
          toolCallId: toolCall.id,
          name: toolCall.name as TName,
          data: response.data ?? null,
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
 * Identity function that provides full type inference for subagent configurations.
 * Verifies the workflow function's input parameters match the configured context,
 * and properly types the lifecycle hooks with Task tool args and inferred result type.
 *
 * @example
 * ```ts
 * // With typed context — workflow must accept { prompt, context }
 * const researcher = defineSubagent({
 *   name: "researcher",
 *   description: "Researches topics",
 *   workflow: researcherWorkflow, // (input: { prompt: string; context: { apiKey: string } }) => Promise<...>
 *   context: { apiKey: "..." },
 *   resultSchema: z.object({ findings: z.string() }),
 *   hooks: {
 *     onPostExecution: ({ result }) => {
 *       // result is typed as { findings: string }
 *     },
 *   },
 * });
 *
 * // Without context — workflow only needs { prompt }
 * const writer = defineSubagent({
 *   name: "writer",
 *   description: "Writes content",
 *   workflow: writerWorkflow, // (input: { prompt: string }) => Promise<...>
 *   resultSchema: z.object({ content: z.string() }),
 * });
 * ```
 */
// With context — verifies workflow accepts { prompt, context: TContext }
export function defineSubagent<
  TResult extends z.ZodType = z.ZodType,
  TContext extends Record<string, unknown> = Record<string, unknown>,
>(
  config: Omit<SubagentConfig<TResult>, "hooks" | "workflow" | "context"> & {
    workflow:
      | string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      | ((input: { prompt: string; context: TContext }) => Promise<any>);
    context: TContext;
    hooks?: SubagentHooks<GenericTaskToolSchemaType, z.infer<TResult>>;
  }
): SubagentConfig<TResult>;
// Without context — verifies workflow accepts { prompt }
export function defineSubagent<TResult extends z.ZodType = z.ZodType>(
  config: Omit<SubagentConfig<TResult>, "hooks" | "workflow"> & {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    workflow: string | ((input: { prompt: string }) => Promise<any>);
    hooks?: SubagentHooks<GenericTaskToolSchemaType, z.infer<TResult>>;
  }
): SubagentConfig<TResult>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineSubagent(config: any): SubagentConfig {
  return config;
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
