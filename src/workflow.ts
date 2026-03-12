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
export {
  createSession,
  proxyDefaultThreadOps,
  proxySandboxOps,
} from "./lib/session";
export type { ZeitlichSession, ThreadOps, SessionConfig } from "./lib/session";
export { defineWorkflow } from "./lib/workflow";
export type { WorkflowInput, WorkflowSessionInput } from "./lib/workflow";

// Thread utilities
export { getShortId } from "./lib/thread";

// State management
export { createAgentStateManager } from "./lib/state";
export type {
  AgentState,
  AgentStateManager,
  JsonSerializable,
  JsonValue,
  JsonPrimitive,
} from "./lib/state";

// Tool router (includes registry functionality)
export {
  createToolRouter,
  hasNoOtherToolCalls,
  defineTool,
} from "./lib/tool-router";
export { defineSubagent, defineSubagentWorkflow } from "./lib/subagent";
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
  ToolRouterHooks,
  // Handler types
  ToolHandler,
  ActivityToolHandler,
  RouterContext,
  ToolHandlerResponse,
  // Result types
  ToolArgs,
  ToolResult,
  ToolCallResult,
  ToolCallResultUnion,
  InferToolResults,
  // Tool hook types
  PreToolUseHook,
  PreToolUseHookContext,
  PreToolUseHookResult,
  PostToolUseHook,
  PostToolUseHookContext,
  PostToolUseFailureHook,
  PostToolUseFailureHookContext,
  PostToolUseFailureHookResult,
  ToolHooks,
  // Other
  AppendToolResultFn,
  ProcessToolCallsContext,
} from "./lib/tool-router";

// Session & message lifecycle hooks
export type {
  Hooks,
  SessionStartHook,
  SessionStartHookContext,
  SessionEndHook,
  SessionEndHookContext,
  PreHumanMessageAppendHook,
  PreHumanMessageAppendHookContext,
  PostHumanMessageAppendHook,
  PostHumanMessageAppendHookContext,
} from "./lib/hooks";

// Core types
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
  AgentConfig,
  RunAgentConfig,
  ToolResultConfig,
  SessionExitReason,
  SerializableToolDefinition,
  // Task types
  TaskStatus,
  WorkflowTask,
} from "./lib/types";
export { isTerminalStatus } from "./lib/types";

// Model types
export type {
  AgentResponse,
  RunAgentActivity,
  ModelInvoker,
  ModelInvokerConfig,
} from "./lib/model";

// Subagent types
export type {
  SubagentConfig,
  SubagentDefinition,
  SubagentHooks,
  SubagentHandlerResponse,
  SubagentWorkflow,
  SubagentWorkflowInput,
  SubagentSessionInput,
} from "./lib/subagent/types";
// Sandbox types (workflow-safe — no activity-side code)
export type {
  Sandbox,
  SandboxCapabilities,
  SandboxCreateOptions,
  SandboxCreateResult,
  SandboxFileSystem,
  SandboxOps,
  SandboxProvider,
  SandboxSnapshot,
  ExecOptions,
  ExecResult,
  DirentEntry as SandboxDirentEntry,
  FileStat as SandboxFileStat,
} from "./lib/sandbox/types";
export {
  SandboxNotFoundError,
  SandboxNotSupportedError,
} from "./lib/sandbox/types";

// Virtual sandbox (workflow-safe — imported from leaf modules to avoid
// pulling activity-side code like VirtualSandboxFileSystem / Provider).
export { applyVirtualTreeMutations } from "./adapters/sandbox/virtual/mutations";
export { formatVirtualFileTree } from "./adapters/sandbox/virtual/tree";
export type {
  FileEntry,
  FileEntryMetadata,
  FileResolver,
  VirtualFileTree,
  VirtualSandboxState,
  TreeMutation,
} from "./adapters/sandbox/virtual/types";

// Subagent support
export type { SubagentArgs } from "./lib/subagent";

// Skills (types + workflow-safe utilities)
export type { Skill, SkillMetadata, SkillProvider } from "./lib/skills/types";
export { parseSkillFile } from "./lib/skills/parse";
export { createReadSkillTool, createReadSkillHandler } from "./lib/skills";
export type { ReadSkillArgs } from "./lib/skills";

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
