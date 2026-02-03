/**
 * Workflow-safe exports for use in Temporal workflow code.
 *
 * Import from '@bead-ai/zeitlich/workflow' in workflow files.
 * These exports have no external dependencies (no Redis, no LangChain).
 *
 * @example
 * ```typescript
 * // In your workflow file
 * import {
 *   createSession,
 *   createAgentStateManager,
 *   createToolRegistry,
 *   createToolRouter,
 * } from '@bead-ai/zeitlich/workflow';
 * ```
 */

// Session
export { createSession } from "./lib/session";
export type { ZeitlichSession, SessionLifecycleHooks } from "./lib/session";

// State management
export {
  createAgentStateManager,
  AGENT_HANDLER_NAMES,
} from "./lib/state-manager";
export type {
  AgentState,
  AgentStateManager,
  AgentStateManagerConfig,
  JsonSerializable,
  JsonValue,
  JsonPrimitive,
} from "./lib/state-manager";

// Prompt management
export { createPromptManager } from "./lib/prompt-manager";
export type { PromptManager, PromptManagerConfig } from "./lib/prompt-manager";

// Tool registry
export { createToolRegistry } from "./lib/tool-registry";
export type {
  ToolDefinition,
  ToolMap,
  ToolRegistry,
  RawToolCall,
  ParsedToolCall,
  ParsedToolCallUnion,
  ToolNames,
} from "./lib/tool-registry";

// Tool router
export { createToolRouter, hasNoOtherToolCalls } from "./lib/tool-router";
export type {
  ToolRouter,
  ToolRouterOptions,
  ToolRouterHooks,
  ToolHandler,
  ActivityToolHandler,
  ToolHandlerResponse,
  ToolHandlerMap,
  ToolCallResult,
  ToolCallResultUnion,
  ToolMessageContent,
  AppendToolResultFn,
  ProcessToolCallsContext,
} from "./lib/tool-router";

// Types
export type {
  AgentStatus,
  BaseAgentState,
  AgentFile,
  AgentResponse,
  ZeitlichAgentConfig,
  RunAgentConfig,
  RunAgentActivity,
  InvocationConfig,
  ToolResultConfig,
  SessionExitReason,
  SessionHooks,
  PreToolUseHook,
  PreToolUseHookContext,
  PreToolUseHookResult,
  PostToolUseHook,
  PostToolUseHookContext,
  PostToolUseFailureHook,
  PostToolUseFailureHookContext,
  PostToolUseFailureHookResult,
  SessionStartHook,
  SessionStartHookContext,
  SessionEndHook,
  SessionEndHookContext,
  SubagentConfig,
  SubagentInput,
} from "./lib/types";
export { isTerminalStatus } from "./lib/types";

// Subagent support
export { createTaskTool } from "./tools/task/tool";
export type {
  TaskToolSchemaType,
  GenericTaskToolSchemaType,
} from "./tools/task/tool";
export { createTaskHandler } from "./tools/task/handler";
export type { TaskHandlerResult } from "./tools/task/handler";
export { withSubagentSupport, hasTaskTool } from "./lib/subagent-support";
export type {
  SubagentSupportConfig,
  SubagentSupportResult,
} from "./lib/subagent-support";

// Activity type interfaces (types only, no runtime code)
// These are safe to import in workflows for typing proxyActivities
export type { ZeitlichSharedActivities } from "./activities";

// Tool definitions (schemas only - no handlers)
export { askUserQuestionTool } from "./tools/ask-user-question/tool";
export type { AskUserQuestionToolSchemaType } from "./tools/ask-user-question/tool";
export { globTool } from "./tools/glob/tool";
export type { GlobToolSchemaType } from "./tools/glob/tool";
export { grepTool } from "./tools/grep/tool";
export type { GrepToolSchemaType } from "./tools/grep/tool";
export { readTool } from "./tools/read/tool";
export type { ReadToolSchemaType } from "./tools/read/tool";
export { writeTool } from "./tools/write/tool";
export type { WriteToolSchemaType } from "./tools/write/tool";
export { editTool } from "./tools/edit/tool";
export type { EditToolSchemaType } from "./tools/edit/tool";

// Filesystem utilities (pure functions, no I/O)
export {
  buildFileTreePrompt,
  flattenFileTree,
  isPathInScope,
  findNodeByPath,
  fileContentToMessageContent,
} from "./lib/filesystem";

export type {
  FileNode,
  FileTreeRenderOptions,
  FileSystemProvider,
  FileSystemToolsConfig,
  GrepOptions,
  GrepMatch,
  FileContent,
  FileResolver,
  BackendConfig,
} from "./lib/filesystem";
