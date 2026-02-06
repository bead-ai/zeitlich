/**
 * Activity-side exports for use in Temporal activity code and worker setup.
 *
 * Import from '@bead-ai/zeitlich' in activity files and worker setup.
 * These exports may have external dependencies (Redis, LangChain).
 *
 * For workflow code, use '@bead-ai/zeitlich/workflow' instead.
 *
 * @example
 * ```typescript
 * // In your activities file
 * import { invokeModel, globHandler } from '@bead-ai/zeitlich';
 *
 * // In your worker file
 * import { ZeitlichPlugin } from '@bead-ai/zeitlich';
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

// Model invocation (requires Redis, LangChain)
export { invokeModel } from "./lib/model-invoker";
export type { InvokeModelConfig } from "./lib/model-invoker";

// Tool handlers (activity implementations)
// These are direct functions that accept scopedNodes per-call for dynamic file trees
export { handleAskUserQuestionToolResult } from "./tools/ask-user-question/handler";
export { globHandler } from "./tools/glob/handler";

export { editHandler } from "./tools/edit/handler";
export type {
  EditResult,
  EditHandlerResponse,
  EditHandlerOptions,
} from "./tools/edit/handler";

export { handleBashTool } from "./tools/bash/handler";

export { toTree } from "./lib/fs";
