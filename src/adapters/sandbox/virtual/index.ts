import type {
  Sandbox,
  SandboxCapabilities,
  ExecOptions,
  ExecResult,
} from "../../../lib/sandbox/types";
import { SandboxNotSupportedError } from "../../../lib/sandbox/types";
import { getShortId } from "../../../lib/thread/id";
import { VirtualSandboxFileSystem } from "./filesystem";
import type { FileEntry, FileResolver, TreeMutation, VirtualFileTree } from "./types";

// ============================================================================
// VirtualSandbox
// ============================================================================

class VirtualSandbox<TCtx = unknown> implements Sandbox {
  readonly capabilities: SandboxCapabilities = {
    filesystem: true,
    execution: false,
    persistence: true,
  };

  readonly fs: VirtualSandboxFileSystem<TCtx>;

  constructor(
    readonly id: string,
    tree: FileEntry[],
    resolver: FileResolver<TCtx>,
    ctx: TCtx,
  ) {
    this.fs = new VirtualSandboxFileSystem(tree, resolver, ctx);
  }

  async exec(_command: string, _options?: ExecOptions): Promise<ExecResult> {
    throw new SandboxNotSupportedError("exec");
  }

  async destroy(): Promise<void> {
    // Ephemeral — nothing to clean up
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an ephemeral {@link Sandbox} from a file tree and resolver.
 *
 * Used internally by {@link withVirtualSandbox}; consumers can also call
 * this directly if they need a sandbox outside the wrapper pattern.
 */
export function createVirtualSandbox<TCtx>(
  tree: FileEntry[],
  resolver: FileResolver<TCtx>,
  ctx: TCtx,
): Sandbox & { fs: VirtualSandboxFileSystem<TCtx> } {
  return new VirtualSandbox(getShortId(), tree, resolver, ctx);
}

// ============================================================================
// buildFileTree activity factory
// ============================================================================

/**
 * Returns a Temporal activity function that resolves a set of file IDs into
 * a {@link VirtualFileTree}. Call once at workflow startup, store the result
 * in `AgentState`.
 *
 * @example
 * ```typescript
 * // Activity-side
 * const resolver: FileResolver<{ projectId: string }> = { ... };
 * export const activities = {
 *   buildFileTree: createBuildFileTreeActivity(resolver),
 * };
 *
 * // Workflow-side
 * const { buildFileTree } = proxyActivities<typeof activities>(...);
 * const fileTree = await buildFileTree(fileIds, { projectId });
 * ```
 */
export function createBuildFileTreeActivity<TCtx>(
  resolver: FileResolver<TCtx>,
): (fileIds: string[], ctx: TCtx) => Promise<VirtualFileTree> {
  return async (fileIds: string[], ctx: TCtx) => {
    return resolver.resolveEntries(fileIds, ctx);
  };
}

// ============================================================================
// applyTreeMutations — workflow-safe pure utility
// ============================================================================

/**
 * Apply a list of {@link TreeMutation}s to a {@link VirtualFileTree},
 * returning a new array. Safe to call from workflow code.
 */
export function applyTreeMutations(
  tree: VirtualFileTree,
  mutations: TreeMutation[],
): VirtualFileTree {
  let result = [...tree];

  for (const m of mutations) {
    switch (m.type) {
      case "add":
        result.push(m.entry);
        break;
      case "remove":
        result = result.filter((e) => e.path !== m.path);
        break;
      case "update":
        result = result.map((e) =>
          e.path === m.path ? { ...e, ...m.entry } : e,
        );
        break;
    }
  }

  return result;
}

// Re-exports for convenience
export { VirtualSandboxFileSystem } from "./filesystem";
export { withVirtualSandbox } from "./with-virtual-sandbox";
export type {
  FileEntry,
  FileResolver,
  VirtualFileTree,
  VirtualSandboxState,
  VirtualSandboxContext,
  TreeMutation,
} from "./types";
