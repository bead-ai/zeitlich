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
  JsonSerializable,
  JsonValue,
  JsonPrimitive,
} from "./lib/state-manager";

// Tool router (includes registry functionality)
export {
  createToolRouter,
  hasNoOtherToolCalls,
  defineTool,
  defineSubagent,
} from "./lib/tool-router";
export type {
  // Tool definition types
  ToolDefinition,
  ToolWithHandler,
  ToolMap,
  ToolNames,
  RawToolCall,
  ParsedToolCall,
  ParsedToolCallUnion,
  // Router types
  ToolRouter,
  // Handler types
  ToolHandler,
  ActivityToolHandler,
  ToolHandlerContext,
  ToolHandlerResponse,
  // Result types
  ToolArgs,
  ToolResult,
  ToolCallResult,
  ToolCallResultUnion,
  InferToolResults,
  // Other
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
  ToolResultConfig,
  SessionExitReason,
  PreToolUseHook,
  PreToolUseHookContext,
  PreToolUseHookResult,
  PostToolUseHook,
  PostToolUseHookContext,
  PostToolUseFailureHook,
  PostToolUseFailureHookContext,
  PostToolUseFailureHookResult,
  ToolHooks,
  SessionStartHook,
  SessionStartHookContext,
  SessionEndHook,
  SessionEndHookContext,
  SubagentConfig,
  SubagentHooks,
  SubagentInput,
  TaskStatus,
  WorkflowTask,
} from "./lib/types";
export { isTerminalStatus } from "./lib/types";

// Subagent support
export { createTaskTool } from "./tools/task/tool";
export type { TaskArgs } from "./tools/task/tool";
export type { TaskHandlerResult } from "./tools/task/handler";

// Activity type interfaces (types only, no runtime code)
// These are safe to import in workflows for typing proxyActivities
export type { ZeitlichSharedActivities } from "./activities";

// Tool definitions (schemas only - no handlers)
export { askUserQuestionTool } from "./tools/ask-user-question/tool";
export type { AskUserQuestionArgs } from "./tools/ask-user-question/tool";
export { globTool } from "./tools/glob/tool";
export type { GlobArgs } from "./tools/glob/tool";
export { grepTool } from "./tools/grep/tool";
export type { GrepArgs } from "./tools/grep/tool";
export { readTool } from "./tools/read-file/tool";
export type { FileReadArgs } from "./tools/read-file/tool";
export { writeTool } from "./tools/write-file/tool";
export type { FileWriteArgs } from "./tools/write-file/tool";
export { editTool } from "./tools/edit/tool";
export type { FileEditArgs } from "./tools/edit/tool";

// Workflow task tools (state-only, no activities needed)
export { taskCreateTool } from "./tools/task-create/tool";
export type { TaskCreateArgs } from "./tools/task-create/tool";
export { createTaskCreateHandler } from "./tools/task-create/handler";

export { taskGetTool } from "./tools/task-get/tool";
export type { TaskGetArgs } from "./tools/task-get/tool";
export { createTaskGetHandler } from "./tools/task-get/handler";

export { taskListTool } from "./tools/task-list/tool";
export type { TaskListArgs } from "./tools/task-list/tool";
export { createTaskListHandler } from "./tools/task-list/handler";

export { taskUpdateTool } from "./tools/task-update/tool";
export type { TaskUpdateArgs } from "./tools/task-update/tool";
export { createTaskUpdateHandler } from "./tools/task-update/handler";

export { bashTool, createBashToolDescription } from "./tools/bash/tool";
export type { BashArgs } from "./tools/bash/tool";
