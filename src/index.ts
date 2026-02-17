/**
 * Activity-side exports for use in Temporal activity code and worker setup.
 *
 * Import from 'zeitlich' in activity files and worker setup.
 * These exports may have external dependencies (Redis, LangChain).
 *
 * For workflow code, use 'zeitlich/workflow' instead.
 *
 * @example
 * ```typescript
 * // In your activities file
 * import { invokeModel, createGlobHandler } from 'zeitlich';
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

// Shared activities (requires Redis)
export { createSharedActivities } from "./activities";
export type { ZeitlichSharedActivities } from "./activities";

// Auto-append wrapper for large tool results (activity-side only)
export { withAutoAppend } from "./lib/tool-router";

// Model invocation (requires Redis, LangChain)
export { invokeModel } from "./lib/model-invoker";
export type { InvokeModelConfig } from "./lib/model-invoker";

// Tool handlers (activity implementations)
// All handlers follow the factory pattern: createXHandler(deps) => handler(args)
export { createAskUserQuestionHandler } from "./tools/ask-user-question/handler";
export { createGlobHandler } from "./tools/glob/handler";

export { createEditHandler } from "./tools/edit/handler";

export { createBashHandler } from "./tools/bash/handler";

export { toTree } from "./lib/fs";

export { getStateQuery } from "./lib/state-manager";
export { createThreadManager } from "./lib/thread-manager";
export type {
  BaseThreadManager,
  ThreadManager,
  ThreadManagerConfig,
} from "./lib/thread-manager";
