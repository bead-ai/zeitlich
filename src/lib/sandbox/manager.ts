import type {
  Sandbox,
  SandboxCreateOptions,
  SandboxOps,
  SandboxProvider,
  SandboxSnapshot,
} from "./types";

/**
 * Stateless facade over a {@link SandboxProvider}.
 *
 * Delegates all lifecycle operations to the provider, which is responsible
 * for its own instance management strategy (e.g. in-memory map, remote API).
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
  constructor(private provider: SandboxProvider) {}

  async create(options?: SandboxCreateOptions): Promise<string> {
    const sandbox = await this.provider.create(options);
    return sandbox.id;
  }

  async getSandbox(id: string): Promise<Sandbox> {
    return this.provider.get(id);
  }

  async destroy(id: string): Promise<void> {
    await this.provider.destroy(id);
  }

  async snapshot(id: string): Promise<SandboxSnapshot> {
    return this.provider.snapshot(id);
  }

  async restore(snapshot: SandboxSnapshot): Promise<string> {
    const sandbox = await this.provider.restore(snapshot);
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
