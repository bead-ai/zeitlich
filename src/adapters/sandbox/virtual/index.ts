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
    ctx: TCtx,
    workspaceBase = "/",
  ) {
    this.fs = new VirtualSandboxFileSystem(tree, resolver, ctx, workspaceBase);
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
  workspaceBase = "/",
): VirtualSandbox<TCtx, TMeta> {
  return new VirtualSandboxImpl(id, tree, resolver, ctx, workspaceBase);
}

// Re-exports for convenience
export { VirtualSandboxFileSystem } from "./filesystem";
export { VirtualSandboxProvider } from "./provider";
export { withVirtualSandbox } from "./with-virtual-sandbox";
export { hasFileWithMimeType, filesWithMimeType } from "./queries";
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
