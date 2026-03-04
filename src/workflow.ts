/**
 * Workflow-safe exports for use in Temporal workflow code.
 *
 * Import from `zeitlich/workflow` in workflow files.
 * These exports have no external dependencies (no Redis, no LangChain).
 *
 * @example
 * ```typescript
 * // In your workflow file
 * import {
 *   createSession,
 *   createAgentStateManager,
 *   askUserQuestionTool,
 *   bashTool,
 *   defineTool,
 *   type SubagentWorkflow,
 * } from 'zeitlich/workflow';
 * ```
 */

// Session
export { createSession, proxyDefaultThreadOps } from "./lib/session";

// Thread utilities
export { getShortId } from "./lib/thread-id";
export type { ZeitlichSession, SessionLifecycleHooks } from "./lib/session";

// State management
export { createAgentStateManager } from "./lib/state-manager";
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
  AppendToolResultFn,
  ProcessToolCallsContext,
} from "./lib/tool-router";

// Types
export type {
  // Message types (framework-agnostic)
  ContentPart,
  MessageContent,
  ToolMessageContent,
  TokenUsage,
  // Agent types
  AgentStatus,
  BaseAgentState,
  AgentFile,
  AgentResponse,
  ThreadOps,
  AgentConfig,
  SessionConfig,
  RunAgentConfig,
  RunAgentActivity,
  ToolResultConfig,
  SessionExitReason,
  // Hook types
  PreToolUseHook,
  PreToolUseHookContext,
  PreToolUseHookResult,
  PostToolUseHook,
  PostToolUseHookContext,
  PostToolUseFailureHook,
  PostToolUseFailureHookContext,
  PostToolUseFailureHookResult,
  PreHumanMessageAppendHook,
  PreHumanMessageAppendHookContext,
  PostHumanMessageAppendHook,
  PostHumanMessageAppendHookContext,
  Hooks,
  ToolHooks,
  SessionStartHook,
  SessionStartHookContext,
  SessionEndHook,
  SessionEndHookContext,
  // Subagent types
  SubagentConfig,
  SubagentHooks,
  SubagentInput,
  // Task types
  TaskStatus,
  WorkflowTask,
} from "./lib/types";
export {
  isTerminalStatus,
  agentQueryName,
  agentStateChangeUpdateName,
} from "./lib/types";

// Model invoker contract
export type { ModelInvoker, ModelInvokerConfig } from "./lib/model-invoker";

// Subagent support
export { createSubagentTool } from "./tools/subagent/tool";
export type { SubagentArgs } from "./tools/subagent/tool";
export type { SubagentWorkflow } from "./lib/types";

// Skills (types + workflow-safe utilities)
export type { Skill, SkillMetadata, SkillProvider } from "./lib/skills/types";
export { parseSkillFile } from "./lib/skills/parse";
export { createReadSkillTool } from "./tools/read-skill/tool";
export { createReadSkillHandler } from "./tools/read-skill/handler";
export type { ReadSkillArgs } from "./tools/read-skill/tool";

// Activity type interfaces (types only, no runtime code)
// These are safe to import in workflows for typing proxyActivities
export type { ZeitlichSharedActivities } from "./activities";

// Tool definitions (schemas only - no handlers)
export { globTool } from "./tools/glob/tool";
export type { GlobArgs } from "./tools/glob/tool";
export { grepTool } from "./tools/grep/tool";
export type { GrepArgs } from "./tools/grep/tool";
export { readFileTool } from "./tools/read-file/tool";
export type { FileReadArgs } from "./tools/read-file/tool";
export { writeFileTool } from "./tools/write-file/tool";
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

export { askUserQuestionTool } from "./tools/ask-user-question/tool";
export type { AskUserQuestionArgs } from "./tools/ask-user-question/tool";
export { createAskUserQuestionHandler } from "./tools/ask-user-question/handler";
