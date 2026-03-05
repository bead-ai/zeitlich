/**
 * Activity-side exports for use in Temporal activity code and worker setup.
 *
 * Import from `zeitlich` in activity files and worker setup.
 * For LangChain-specific adapters (model invoker, thread manager, adapter),
 * import from `zeitlich/adapters/thread/langchain`.
 * For workflow code, use `zeitlich/workflow` instead.
 *
 * @example
 * ```typescript
 * // In your activities file
 * import {
 *   SandboxManager,
 *   createBashHandler,
 *   createEditHandler,
 *   toTree,
 * } from 'zeitlich';
 *
 * // In-memory sandbox adapter
 * import { InMemorySandboxProvider } from 'zeitlich/adapters/sandbox/inmemory';
 *
 * // LangChain adapter
 * import { createLangChainAdapter } from 'zeitlich/adapters/thread/langchain';
 * ```
 */

// Re-export all workflow-safe exports for convenience
// (Activities can use these too)
export * from "./workflow";

// Thread manager (generic, framework-agnostic)
export { createThreadManager } from "./lib/thread-manager";
export type {
  BaseThreadManager,
  ThreadManagerConfig,
} from "./lib/thread-manager";

// Model invoker contract (framework-agnostic)
export type { ModelInvoker, ModelInvokerConfig } from "./lib/model-invoker";

// Auto-append wrapper for large tool results (activity-side only)
export { withAutoAppend } from "./lib/tool-router";

// Workflow state helpers (requires Temporal client)
export {
  queryParentWorkflowState,
  createRunAgentActivity,
} from "./lib/workflow-helpers";

// Sandbox (activity-side: manager)
export { SandboxManager } from "./lib/sandbox/manager";

// Tool handlers (activity implementations)
// All handlers follow the factory pattern: createXHandler(getSandbox) => handler(args, context)
export { createGlobHandler } from "./tools/glob/handler";

export { createEditHandler } from "./tools/edit/handler";

export { createBashHandler } from "./tools/bash/handler";

export { createReadFileHandler } from "./tools/read-file/handler";

export { createWriteFileHandler } from "./tools/write-file/handler";

export { toTree } from "./lib/fs";

// Skills (activity-side: filesystem provider)
export { FileSystemSkillProvider } from "./lib/skills/fs-provider";
