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
// applyTreeMutations — workflow-safe pure utility
// ============================================================================

/**
 * Apply a list of {@link TreeMutation}s to a {@link VirtualFileTree},
 * returning a new array. Safe to call from workflow code.
 */
export function applyTreeMutations<
  TMeta = FileEntryMetadata,
>(
  tree: VirtualFileTree<TMeta>,
  mutations: TreeMutation<TMeta>[]
): VirtualFileTree<TMeta> {
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
          e.path === m.path ? { ...e, ...m.entry } : e
        );
        break;
    }
  }

  return result;
}

// Re-exports for convenience
export { VirtualSandboxFileSystem } from "./filesystem";
export { VirtualSandboxProvider } from "./provider";
export { withVirtualSandbox } from "./with-virtual-sandbox";
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
