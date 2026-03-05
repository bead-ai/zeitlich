import type {
  Sandbox,
  SandboxCreateOptions,
  SandboxOps,
  SandboxProvider,
  SandboxSnapshot,
} from "./types";
import { SandboxNotFoundError } from "./types";

/**
 * Activity-side registry that holds live {@link Sandbox} instances keyed by ID.
 *
 * Create one per worker and pass it to tool handler factories so they can
 * look up the sandbox for the current workflow.
 *
 * @example
 * ```typescript
 * const manager = new SandboxManager(new InMemorySandboxProvider());
 * const activities = {
 *   ...manager.createActivities(),
 *   bashHandler: withSandbox(manager, bashHandler),
 * };
 * ```
 */
export class SandboxManager {
  private sandboxes = new Map<string, Sandbox>();

  constructor(private provider: SandboxProvider) {}

  async create(options?: SandboxCreateOptions): Promise<string> {
    const sandbox = await this.provider.create(options);
    this.sandboxes.set(sandbox.id, sandbox);
    return sandbox.id;
  }

  getSandbox(id: string): Sandbox {
    const sandbox = this.sandboxes.get(id);
    if (!sandbox) throw new SandboxNotFoundError(id);
    return sandbox;
  }

  has(id: string): boolean {
    return this.sandboxes.has(id);
  }

  async destroy(id: string): Promise<void> {
    const sandbox = this.sandboxes.get(id);
    if (sandbox) {
      await sandbox.destroy();
      this.sandboxes.delete(id);
    }
  }

  async snapshot(id: string): Promise<SandboxSnapshot> {
    if (!this.sandboxes.has(id)) throw new SandboxNotFoundError(id);
    return this.provider.snapshot(id);
  }

  async restore(snapshot: SandboxSnapshot): Promise<string> {
    const sandbox = await this.provider.restore(snapshot);
    this.sandboxes.set(sandbox.id, sandbox);
    return sandbox.id;
  }

  /**
   * Returns Temporal activity functions matching {@link SandboxOps}.
   * Spread these into your worker's activity map.
   */
  createActivities(): SandboxOps {
    return {
      createSandbox: async (
        options?: SandboxCreateOptions
      ): Promise<{ sandboxId: string }> => {
        const sandboxId = await this.create(options);
        return { sandboxId };
      },
      destroySandbox: async (sandboxId: string): Promise<void> => {
        await this.destroy(sandboxId);
      },
      snapshotSandbox: async (sandboxId: string): Promise<SandboxSnapshot> => {
        return this.snapshot(sandboxId);
      },
    };
  }
}
