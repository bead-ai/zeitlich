import type {
  Sandbox,
  SandboxCreateOptions,
  SandboxOps,
  PrefixedSandboxOps,
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
export class SandboxManager<
  TOptions extends SandboxCreateOptions = SandboxCreateOptions,
  TSandbox extends Sandbox = Sandbox,
> {
  constructor(private provider: SandboxProvider<TOptions, TSandbox>) {}

  async create(
    options?: TOptions
  ): Promise<{ sandboxId: string; stateUpdate?: Record<string, unknown> }> {
    const { sandbox, stateUpdate } = await this.provider.create(options);
    return { sandboxId: sandbox.id, ...(stateUpdate && { stateUpdate }) };
  }

  async getSandbox(id: string): Promise<TSandbox> {
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
   *
   * @deprecated Use {@link createPrefixedActivities} to register
   * adapter-specific activity names and avoid collisions.
   */
  createActivities(): SandboxOps<TOptions> {
    return {
      createSandbox: async (
        options?: TOptions
      ): Promise<{
        sandboxId: string;
        stateUpdate?: Record<string, unknown>;
      }> => {
        return this.create(options);
      },
      destroySandbox: async (sandboxId: string): Promise<void> => {
        await this.destroy(sandboxId);
      },
      snapshotSandbox: async (sandboxId: string): Promise<SandboxSnapshot> => {
        return this.snapshot(sandboxId);
      },
    };
  }

  /**
   * Returns Temporal activity functions with adapter-prefixed names.
   * Use the matching `proxy*SandboxOps()` helper from the adapter's
   * `/workflow` entrypoint to map them back to generic {@link SandboxOps}.
   *
   * @example
   * ```typescript
   * const manager = new SandboxManager(new InMemorySandboxProvider());
   * const activities = {
   *   ...manager.createPrefixedActivities("inMemory"),
   * };
   * // registers: inMemoryCreateSandbox, inMemoryDestroySandbox, inMemorySnapshotSandbox
   * ```
   */
  createPrefixedActivities<P extends string>(
    prefix: P
  ): PrefixedSandboxOps<P, TOptions> {
    const ops = this.createActivities();
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    return Object.fromEntries(
      Object.entries(ops).map(([k, v]) => [`${prefix}${cap(k)}`, v])
    ) as PrefixedSandboxOps<P, TOptions>;
  }
}
