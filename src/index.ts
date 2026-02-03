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
 * import { invokeModel, createGlobHandler } from '@bead-ai/zeitlich';
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
export { handleAskUserQuestionToolResult } from "./tools/ask-user-question/handler";
export { createGlobHandler } from "./tools/glob/handler";
export type { GlobHandlerConfig } from "./tools/glob/handler";
export { createGrepHandler } from "./tools/grep/handler";
export type { GrepHandlerConfig } from "./tools/grep/handler";
export { createReadHandler } from "./tools/read/handler";
export type { ReadHandlerConfig } from "./tools/read/handler";
export { createWriteHandler } from "./tools/write/handler";
export type { WriteHandlerConfig, WriteResult } from "./tools/write/handler";
export { createEditHandler } from "./tools/edit/handler";
export type { EditHandlerConfig, EditResult } from "./tools/edit/handler";

// Filesystem providers (for activity implementations)
export {
  BaseFileSystemProvider,
  InMemoryFileSystemProvider,
  CompositeFileSystemProvider,
} from "./lib/filesystem";
