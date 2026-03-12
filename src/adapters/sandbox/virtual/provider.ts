import type {
  SandboxCapabilities,
  SandboxCreateResult,
  SandboxProvider,
} from "../../../lib/sandbox/types";
import { SandboxNotSupportedError } from "../../../lib/sandbox/types";
import { getShortId } from "../../../lib/thread/id";
import { createVirtualSandbox } from "./index";
import type {
  FileEntryMetadata,
  FileResolver,
  VirtualSandboxCreateOptions,
} from "./types";

/**
 * Stateless {@link SandboxProvider} backed by a {@link FileResolver}.
 *
 * The provider holds **no internal state**. All sandbox state (sandboxId,
 * fileTree, resolverContext, workspaceBase) is returned as a `stateUpdate` from
 * {@link create} and merged into the workflow's `AgentState` by the session.
 * {@link withVirtualSandbox} reads this state back on every tool invocation.
 *
 * @example
 * ```typescript
 * const provider = new VirtualSandboxProvider(resolver);
 * const manager = new SandboxManager(provider);
 *
 * export const activities = {
 *   ...manager.createActivities(),
 *   readFile: withVirtualSandbox(client, provider, readHandler),
 * };
 * ```
 */
export class VirtualSandboxProvider<
  TCtx = unknown,
  TMeta = FileEntryMetadata,
> implements SandboxProvider<VirtualSandboxCreateOptions<TCtx>> {
  readonly id = "virtual";
  readonly capabilities: SandboxCapabilities = {
    filesystem: true,
    execution: false,
    persistence: true,
  };

  readonly resolver: FileResolver<TCtx, TMeta>;

  constructor(resolver: FileResolver<TCtx, TMeta>) {
    this.resolver = resolver;
  }

  async create(
    options?: VirtualSandboxCreateOptions<TCtx>
  ): Promise<SandboxCreateResult> {
    if (!options || !("resolverContext" in options)) {
      throw new Error("VirtualSandboxProvider.create requires resolverContext");
    }

    const sandboxId = options.id ?? getShortId();
    const fileTree = await this.resolver.resolveEntries(
      options.resolverContext
    );
    const workspaceBase = options.workspaceBase ?? "/";

    const sandbox = createVirtualSandbox(
      sandboxId,
      fileTree,
      this.resolver,
      options.resolverContext,
      workspaceBase,
    );

    return {
      sandbox,
      stateUpdate: {
        sandboxId,
        fileTree,
        resolverContext: options.resolverContext,
        workspaceBase,
      },
    };
  }

  async get(): Promise<never> {
    throw new SandboxNotSupportedError(
      "get (virtual sandbox state lives in workflow AgentState)"
    );
  }

  async destroy(): Promise<void> {
    // No-op — no internal state to clean up
  }

  async snapshot(): Promise<never> {
    throw new SandboxNotSupportedError(
      "snapshot (virtual sandbox state lives in workflow AgentState)"
    );
  }

  async restore(): Promise<never> {
    throw new SandboxNotSupportedError(
      "restore (virtual sandbox state lives in workflow AgentState)"
    );
  }
}
