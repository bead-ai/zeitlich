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
 *   withSandbox,
 *   bashHandler,
 *   editHandler,
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

export type { AgentStateContext } from "./lib/activity";
// Activity-side wrappers (requires Temporal client)
export {
  createRunAgentActivity,
  queryParentWorkflowState,
  withParentWorkflowState,
} from "./lib/activity";
// Model invoker contract (framework-agnostic)
export type { ModelInvoker, ModelInvokerConfig } from "./lib/model";
export { toTree } from "./lib/sandbox";
// Sandbox (activity-side: manager)
export { SandboxManager } from "./lib/sandbox/manager";
// Skills (activity-side: filesystem provider uses node:path)
export { FileSystemSkillProvider } from "./lib/skills/fs-provider";
export type { BaseThreadManager, ThreadManagerConfig } from "./lib/thread";
// Thread manager (generic, framework-agnostic)
export { createThreadManager } from "./lib/thread";
export type { SandboxContext } from "./lib/tool-router";
// Activity-side handler wrappers
export { withAutoAppend, withSandbox } from "./lib/tool-router";

// Tool handlers (activity implementations)
// Wrap sandbox handlers with withSandbox(manager, handler) at registration time
export { bashHandler } from "./tools/bash/handler";
export { editHandler } from "./tools/edit/handler";
export { globHandler } from "./tools/glob/handler";
export { readFileHandler } from "./tools/read-file/handler";
export { writeFileHandler } from "./tools/write-file/handler";
// Re-export all workflow-safe exports for convenience
// (Activities can use these too)
export * from "./workflow";
