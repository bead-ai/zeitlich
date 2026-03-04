/**
 * Activity-side exports for use in Temporal activity code and worker setup.
 *
 * Import from `zeitlich` in activity files and worker setup.
 * For LangChain-specific adapters (model invoker, thread manager, shared
 * activities), import from `zeitlich/langchain`.
 * For workflow code, use `zeitlich/workflow` instead.
 *
 * @example
 * ```typescript
 * // In your activities file
 * import {
 *   createBashHandler,
 *   createAskUserQuestionHandler,
 *   toTree,
 * } from 'zeitlich';
 *
 * // LangChain adapter
 * import {
 *   createLangChainModelInvoker,
 *   createLangChainSharedActivities,
 * } from 'zeitlich/langchain';
 *
 * // In your worker file
 * import { ZeitlichPlugin } from 'zeitlich';
 * ```
 */

// Re-export all workflow-safe exports for convenience
// (Activities can use these too)
export * from "./workflow";

// Plugin (requires Redis)
export { ZeitlichPlugin } from "./plugin";
export type { ZeitlichPluginOptions } from "./plugin";

// Shared activities interface (framework-agnostic)
export type { ZeitlichSharedActivities } from "./activities";

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
export { queryParentWorkflowState } from "./lib/workflow-helpers";

// Tool handlers (activity implementations)
// All handlers follow the factory pattern: createXHandler(deps) => handler(args)
export { createGlobHandler } from "./tools/glob/handler";

export { createEditHandler } from "./tools/edit/handler";

export { createBashHandler } from "./tools/bash/handler";

export { toTree } from "./lib/fs";

// Skills (activity-side: filesystem provider)
export { FileSystemSkillProvider } from "./lib/skills/fs-provider";
