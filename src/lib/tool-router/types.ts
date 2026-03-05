import type {
  ToolMessageContent,
  TokenUsage,
  ToolResultConfig,
  MessageContent,
  SessionExitReason,
} from "../types";
import type { SubagentConfig } from "../subagent/types";
import type { Skill } from "../skills/types";
import type { z } from "zod";

// ============================================================================
// Tool Definition Types
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
  /** Whether this tool is available to the agent (default: true). Disabled tools are excluded from definitions and rejected at parse time. */
  enabled?: boolean;
  /** Per-tool lifecycle hooks (run in addition to global hooks) */
  hooks?: ToolHooks<z.infer<TSchema>, TResult>;
}

/**
 * A map of tool keys to tool definitions with handlers.
 *
 * Handler uses `any` intentionally — this is a type-system boundary where heterogeneous
 * tool types are stored together. Type safety for individual tools is enforced by
 * `defineTool()` at the definition site and generic inference utilities like
 * `InferToolResults<T>` at the consumption site.
 */
export type ToolMap = Record<
  string,
  {
    name: string;
    description: string;
    schema: z.ZodType;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: ToolHandler<any, any, any>;
    strict?: boolean;
    max_uses?: number;
    enabled?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hooks?: ToolHooks<any, any>;
  }
>;

/**
 * Extract the tool names from a tool map (uses the tool's name property, not the key).
 */
export type ToolNames<T extends ToolMap> = T[keyof T]["name"];

// ============================================================================
// Raw/Parsed Tool Call Types
// ============================================================================

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
 *
 * Tools that don't return additional data should use `data: null` (TResult defaults to null).
 * Tools that may fail to produce data should type TResult as `SomeType | null`.
 */
export interface ToolHandlerResponse<TResult = null> {
  /** Content sent back to the LLM as the tool call response */
  toolResponse: ToolMessageContent;
  /** Data returned to the workflow and hooks for further processing */
  data: TResult;
  /**
   * When true, the tool result has already been appended to the thread
   * by the handler itself (e.g. via `withAutoAppend`), so the router
   * will skip the `appendToolResult` call. This avoids sending large
   * payloads through Temporal's activity payload limit.
   */
  resultAppended?: boolean;
  /** Token usage from the tool execution (e.g. child agent invocations) */
  usage?: TokenUsage;
  /** Thread ID used by the handler (surfaced to the LLM for subagent thread continuation) */
  threadId?: string;
}

/**
 * Context passed to tool handlers for additional data beyond tool args.
 * Use this to pass workflow state like file trees, user context, etc.
 * Generic so callers can type the context shape, e.g. ToolHandlerContext<ControlTestFsParams>.
 */
export type ToolHandlerContext<T = Record<string, unknown>> = T;

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
 *   FileReadArgs,
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
  data: TResult;
  usage?: TokenUsage;
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
  /** Active sandbox ID (when a sandbox is configured for this session) */
  sandboxId?: string;
}

// ============================================================================
// Hook Types
// ============================================================================

/**
 * Result from PreToolUse hook - can block or modify execution
 */
export interface PreToolUseHookResult {
  /** Skip this tool call entirely */
  skip?: boolean;
  /** Modified args to use instead (must match schema) */
  modifiedArgs?: unknown;
}

/**
 * Result from PostToolUseFailure hook - can recover from errors
 */
export interface PostToolUseFailureHookResult {
  /** Provide a fallback result instead of throwing */
  fallbackContent?: ToolMessageContent;
  /** Whether to suppress the error (still logs, but continues) */
  suppress?: boolean;
}

/**
 * Per-tool lifecycle hooks - defined directly on a tool definition.
 * Runs in addition to global hooks (global pre → tool pre → execute → tool post → global post).
 */
export interface ToolHooks<TArgs = unknown, TResult = unknown> {
  /** Called before this tool executes - can skip or modify args */
  onPreToolUse?: (ctx: {
    args: TArgs;
    threadId: string;
    turn: number;
  }) => PreToolUseHookResult | Promise<PreToolUseHookResult>;
  /** Called after this tool executes successfully */
  onPostToolUse?: (ctx: {
    args: TArgs;
    result: TResult;
    threadId: string;
    turn: number;
    durationMs: number;
  }) => void | Promise<void>;
  /** Called when this tool execution fails */
  onPostToolUseFailure?: (ctx: {
    args: TArgs;
    error: Error;
    threadId: string;
    turn: number;
  }) => PostToolUseFailureHookResult | Promise<PostToolUseFailureHookResult>;
}

/**
 * Context for PreToolUse hook - called before tool execution
 */
export interface PreToolUseHookContext<T extends ToolMap> {
  /** The tool call about to be executed */
  toolCall: ParsedToolCallUnion<T>;
  /** Thread identifier */
  threadId: string;
  /** Current turn number */
  turn: number;
}

/**
 * PreToolUse hook - called before tool execution, can block or modify
 */
export type PreToolUseHook<T extends ToolMap> = (
  ctx: PreToolUseHookContext<T>
) => PreToolUseHookResult | Promise<PreToolUseHookResult>;

/**
 * Context for PostToolUse hook - called after successful tool execution
 */
export interface PostToolUseHookContext<T extends ToolMap, TResult = unknown> {
  /** The tool call that was executed */
  toolCall: ParsedToolCallUnion<T>;
  /** The result from the tool handler */
  result: TResult;
  /** Thread identifier */
  threadId: string;
  /** Current turn number */
  turn: number;
  /** Execution duration in milliseconds */
  durationMs: number;
}

/**
 * PostToolUse hook - called after successful tool execution
 */
export type PostToolUseHook<T extends ToolMap, TResult = unknown> = (
  ctx: PostToolUseHookContext<T, TResult>
) => void | Promise<void>;

/**
 * Context for PostToolUseFailure hook - called when tool execution fails
 */
export interface PostToolUseFailureHookContext<T extends ToolMap> {
  /** The tool call that failed */
  toolCall: ParsedToolCallUnion<T>;
  /** The error that occurred */
  error: Error;
  /** Thread identifier */
  threadId: string;
  /** Current turn number */
  turn: number;
}

/**
 * PostToolUseFailure hook - called when tool execution fails
 */
export type PostToolUseFailureHook<T extends ToolMap> = (
  ctx: PostToolUseFailureHookContext<T>
) => PostToolUseFailureHookResult | Promise<PostToolUseFailureHookResult>;

/**
 * Context for SessionStart hook - called when session begins
 */
export interface SessionStartHookContext {
  /** Thread identifier */
  threadId: string;
  /** Name of the agent */
  agentName: string;
  /** Session metadata */
  metadata: Record<string, unknown>;
}

/**
 * SessionStart hook - called when session begins
 */
export type SessionStartHook = (
  ctx: SessionStartHookContext
) => void | Promise<void>;

/**
 * Context for PreHumanMessageAppend hook - called before each human message is appended to the thread
 */
export interface PreHumanMessageAppendHookContext {
  /** The message about to be appended */
  message: MessageContent;
  /** Thread identifier */
  threadId: string;
}

/**
 * PreHumanMessageAppend hook - called before each human message is appended to the thread
 */
export type PreHumanMessageAppendHook = (
  ctx: PreHumanMessageAppendHookContext
) => void | Promise<void>;

/**
 * PostHumanMessageAppend hook - called after each human message is appended to the thread
 */
export type PostHumanMessageAppendHook = (
  ctx: PostHumanMessageAppendHookContext
) => void | Promise<void>;

/**
 * Context for PostHumanMessageAppend hook - called after each human message is appended to the thread
 */
export interface PostHumanMessageAppendHookContext {
  /** The message that was appended */
  message: MessageContent;
  /** Thread identifier */
  threadId: string;
}

/**
 * Context for SessionEnd hook - called when session ends
 */
export interface SessionEndHookContext {
  /** Thread identifier */
  threadId: string;
  /** Name of the agent */
  agentName: string;
  /** Reason the session ended */
  exitReason: SessionExitReason;
  /** Total turns executed */
  turns: number;
  /** Session metadata */
  metadata: Record<string, unknown>;
}

/**
 * SessionEnd hook - called when session ends
 */
export type SessionEndHook = (
  ctx: SessionEndHookContext
) => void | Promise<void>;

/**
 * Combined hooks interface for session lifecycle
 */
export interface Hooks<T extends ToolMap, TResult = unknown> {
  /** Called before each human message is appended to the thread */
  onPreHumanMessageAppend?: PreHumanMessageAppendHook;
  /** Called after each human message is appended to the thread */
  onPostHumanMessageAppend?: PostHumanMessageAppendHook;
  /** Called before each tool execution - can block or modify */
  onPreToolUse?: PreToolUseHook<T>;
  /** Called after each successful tool execution */
  onPostToolUse?: PostToolUseHook<T, TResult>;
  /** Called when tool execution fails */
  onPostToolUseFailure?: PostToolUseFailureHook<T>;
  /** Called when session starts */
  onSessionStart?: SessionStartHook;
  /** Called when session ends */
  onSessionEnd?: SessionEndHook;
}

// ============================================================================
// Router Options & Interface
// ============================================================================

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
  hooks?: Hooks<T, ToolCallResultUnion<InferToolResults<T>>>;
  /** Subagent configurations */
  subagents?: SubagentConfig[];
  /** Skills available to the agent (auto-adds ReadSkill tool when non-empty) */
  skills?: Skill[];
}

/**
 * The tool router interface with full type inference for both args and results.
 */
export interface ToolRouter<T extends ToolMap> {
  /** Check if the router has any tools */
  hasTools(): boolean;

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
