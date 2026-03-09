import type {
  Sandbox,
  SandboxCapabilities,
  ExecOptions,
  ExecResult,
} from "../../../lib/sandbox/types";
import { SandboxNotSupportedError } from "../../../lib/sandbox/types";
import { VirtualSandboxFileSystem } from "./filesystem";
import type {
  FileEntry,
  FileEntryMetadata,
  FileResolver,
  TreeMutation,
  VirtualFileTree,
  VirtualSandbox,
} from "./types";

// ============================================================================
// VirtualSandbox
// ============================================================================

class VirtualSandboxImpl<
  TCtx = unknown,
  TMeta = FileEntryMetadata,
> implements Sandbox
{
  readonly capabilities: SandboxCapabilities = {
    filesystem: true,
    execution: false,
    persistence: true,
  };

  readonly fs: VirtualSandboxFileSystem<TCtx, TMeta>;

  constructor(
    readonly id: string,
    tree: FileEntry<TMeta>[],
    resolver: FileResolver<TCtx, TMeta>,
    ctx: TCtx
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
 * Used internally by {@link withVirtualSandbox} and
 * {@link VirtualSandboxProvider}; consumers can also call this directly
 * if they need a sandbox outside the wrapper pattern.
 */
export function createVirtualSandbox<
  TCtx,
  TMeta = FileEntryMetadata,
>(
  id: string,
  tree: FileEntry<TMeta>[],
  resolver: FileResolver<TCtx, TMeta>,
  ctx: TCtx,
): VirtualSandbox<TCtx, TMeta> {
  return new VirtualSandboxImpl(id, tree, resolver, ctx);
}

// ============================================================================
// applyTreeMutations — workflow-safe utility
// ============================================================================

/**
 * Apply a list of {@link TreeMutation}s to the `fileTree` stored in a state
 * manager instance, updating it in place and returning the new tree.
 *
 * The `stateManager` parameter is structurally typed so any
 * {@link AgentStateManager} whose custom state includes
 * `fileTree: VirtualFileTree<TMeta>` will satisfy it.
 */
export function applyTreeMutations<TMeta = FileEntryMetadata>(
  stateManager: {
    get(key: "fileTree"): VirtualFileTree<TMeta>;
    set(key: "fileTree", value: VirtualFileTree<TMeta>): void;
  },
  mutations: TreeMutation<TMeta>[],
): VirtualFileTree<TMeta> {
  let tree = [...stateManager.get("fileTree")];

  for (const m of mutations) {
    switch (m.type) {
      case "add":
        tree.push(m.entry);
        break;
      case "remove":
        tree = tree.filter((e) => e.path !== m.path);
        break;
      case "update":
        tree = tree.map((e) =>
          e.path === m.path ? { ...e, ...m.entry } : e
        );
        break;
    }
  }

  stateManager.set("fileTree", tree);
  return tree;
}

// Re-exports for convenience
export { VirtualSandboxFileSystem } from "./filesystem";
export { VirtualSandboxProvider } from "./provider";
export { withVirtualSandbox } from "./with-virtual-sandbox";
export { fileEntriesToTree } from "./tree";
export type {
  FileEntry,
  FileEntryMetadata,
  FileResolver,
  VirtualFileTree,
  VirtualSandboxCreateOptions,
  VirtualSandboxState,
  VirtualSandboxContext,
  VirtualSandbox,
  TreeMutation,
} from "./types";
