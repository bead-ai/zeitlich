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

// Virtual sandbox (workflow-safe — imported from leaf modules to avoid
// pulling activity-side code like VirtualSandboxFileSystem / Provider).
export { applyVirtualTreeMutations } from "./adapters/sandbox/virtual/mutations";
export { formatVirtualFileTree } from "./adapters/sandbox/virtual/tree";
export type {
  FileEntry,
  FileEntryMetadata,
  FileResolver,
  TreeMutation,
  VirtualFileTree,
  VirtualSandboxState,
} from "./adapters/sandbox/virtual/types";
// Session & message lifecycle hooks
export type {
  Hooks,
  PostHumanMessageAppendHook,
  PostHumanMessageAppendHookContext,
  PreHumanMessageAppendHook,
  PreHumanMessageAppendHookContext,
  SessionEndHook,
  SessionEndHookContext,
  SessionStartHook,
  SessionStartHookContext,
} from "./lib/hooks";
// Model types
export type {
  AgentResponse,
  ModelInvoker,
  ModelInvokerConfig,
  RunAgentActivity,
} from "./lib/model";
// Sandbox types (workflow-safe — no activity-side code)
export type {
  DirentEntry as SandboxDirentEntry,
  ExecOptions,
  ExecResult,
  FileStat as SandboxFileStat,
  Sandbox,
  SandboxCapabilities,
  SandboxCreateOptions,
  SandboxCreateResult,
  SandboxFileSystem,
  SandboxOps,
  SandboxProvider,
  SandboxSnapshot,
} from "./lib/sandbox/types";
export {
  SandboxNotFoundError,
  SandboxNotSupportedError,
} from "./lib/sandbox/types";
export type { SessionConfig, ThreadOps, ZeitlichSession } from "./lib/session";
// Session
export {
  createSession,
  proxyDefaultThreadOps,
  proxySandboxOps,
} from "./lib/session";
export type { ReadSkillArgs } from "./lib/skills";
export { createReadSkillHandler, createReadSkillTool } from "./lib/skills";
export { parseSkillFile } from "./lib/skills/parse";
// Skills (types + workflow-safe utilities)
export type { Skill, SkillMetadata, SkillProvider } from "./lib/skills/types";
export type {
  AgentState,
  AgentStateManager,
  JsonPrimitive,
  JsonSerializable,
  JsonValue,
} from "./lib/state";
// State management
export { createAgentStateManager } from "./lib/state";
// Subagent support
export type { SubagentArgs } from "./lib/subagent";
export { defineSubagent } from "./lib/subagent";
// Subagent types
export type {
  SubagentConfig,
  SubagentHandlerResponse,
  SubagentHooks,
  SubagentInput,
  SubagentWorkflow,
} from "./lib/subagent/types";
// Thread utilities
export { getShortId } from "./lib/thread";
export type {
  ActivityToolHandler,
  // Other
  AppendToolResultFn,
  InferToolResults,
  ParsedToolCall,
  ParsedToolCallUnion,
  PostToolUseFailureHook,
  PostToolUseFailureHookContext,
  PostToolUseFailureHookResult,
  PostToolUseHook,
  PostToolUseHookContext,
  // Tool hook types
  PreToolUseHook,
  PreToolUseHookContext,
  PreToolUseHookResult,
  ProcessToolCallsContext,
  RawToolCall,
  RouterContext,
  // Result types
  ToolArgs,
  ToolCallResult,
  ToolCallResultUnion,
  // Tool definition types
  ToolDefinition,
  // Handler types
  ToolHandler,
  ToolHandlerResponse,
  ToolHooks,
  ToolMap,
  ToolNames,
  ToolResult,
  // Router types
  ToolRouter,
  ToolRouterHooks,
  ToolWithHandler,
} from "./lib/tool-router";
// Tool router (includes registry functionality)
export {
  createToolRouter,
  defineTool,
  hasNoOtherToolCalls,
} from "./lib/tool-router";
// Core types
export type {
  AgentConfig,
  AgentFile,
  // Agent types
  AgentStatus,
  BaseAgentState,
  // Message types (framework-agnostic)
  ContentPart,
  MessageContent,
  RunAgentConfig,
  SerializableToolDefinition,
  SessionExitReason,
  // Task types
  TaskStatus,
  TokenUsage,
  ToolMessageContent,
  ToolResultConfig,
  WorkflowTask,
} from "./lib/types";
export { isTerminalStatus } from "./lib/types";
export { createAskUserQuestionHandler } from "./tools/ask-user-question/handler";
export type { AskUserQuestionArgs } from "./tools/ask-user-question/tool";
export { askUserQuestionTool } from "./tools/ask-user-question/tool";
export type { BashArgs } from "./tools/bash/tool";
export { bashTool, createBashToolDescription } from "./tools/bash/tool";
export type { FileEditArgs } from "./tools/edit/tool";
export { editTool } from "./tools/edit/tool";
export type { GlobArgs } from "./tools/glob/tool";
// Tool definitions (schemas only - no handlers)
export { globTool } from "./tools/glob/tool";
export type { GrepArgs } from "./tools/grep/tool";
export { grepTool } from "./tools/grep/tool";
export type { FileReadArgs } from "./tools/read-file/tool";
export { readFileTool } from "./tools/read-file/tool";
export { createTaskCreateHandler } from "./tools/task-create/handler";
export type { TaskCreateArgs } from "./tools/task-create/tool";
// Workflow task tools (state-only, no activities needed)
export { taskCreateTool } from "./tools/task-create/tool";
export { createTaskGetHandler } from "./tools/task-get/handler";
export type { TaskGetArgs } from "./tools/task-get/tool";
export { taskGetTool } from "./tools/task-get/tool";
export { createTaskListHandler } from "./tools/task-list/handler";
export type { TaskListArgs } from "./tools/task-list/tool";
export { taskListTool } from "./tools/task-list/tool";
export { createTaskUpdateHandler } from "./tools/task-update/handler";
export type { TaskUpdateArgs } from "./tools/task-update/tool";
export { taskUpdateTool } from "./tools/task-update/tool";
export type { FileWriteArgs } from "./tools/write-file/tool";
export { writeFileTool } from "./tools/write-file/tool";
