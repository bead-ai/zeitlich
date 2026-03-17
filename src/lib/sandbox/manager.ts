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
 *   ...manager.createActivities("inMemoryCodingAgent"),
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

  async pause(id: string, ttlSeconds?: number): Promise<void> {
    await this.provider.pause(id, ttlSeconds);
  }

  async snapshot(id: string): Promise<SandboxSnapshot> {
    return this.provider.snapshot(id);
  }

  async restore(snapshot: SandboxSnapshot): Promise<string> {
    const sandbox = await this.provider.restore(snapshot);
    return sandbox.id;
  }

  async fork(sandboxId: string): Promise<string> {
    const sandbox = await this.provider.fork(sandboxId);
    return sandbox.id;
  }

  /**
   * Returns Temporal activity functions with prefixed names.
   * Use the matching `proxy*SandboxOps()` helper from the adapter's
   * `/workflow` entrypoint to map them back to generic {@link SandboxOps}.
   *
   * @param prefix - Composite prefix, typically `${workflowName}${AdapterName}`
   *
   * @example
   * ```typescript
   * const manager = new SandboxManager(new InMemorySandboxProvider());
   * const activities = {
   *   ...manager.createActivities("inMemoryCodingAgent"),
   * };
   * // registers: inMemoryCodingAgentCreateSandbox, inMemoryCodingAgentDestroySandbox, …
   * ```
   */
  createActivities<P extends string>(
    prefix: P
  ): PrefixedSandboxOps<P, TOptions> {
    const ops: SandboxOps<TOptions> = {
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
      pauseSandbox: async (sandboxId: string, ttlSeconds?: number): Promise<void> => {
        await this.pause(sandboxId, ttlSeconds);
      },
      snapshotSandbox: async (sandboxId: string): Promise<SandboxSnapshot> => {
        return this.snapshot(sandboxId);
      },
      forkSandbox: async (sandboxId: string): Promise<string> => {
        return this.fork(sandboxId);
      },
    };
    const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
    return Object.fromEntries(
      Object.entries(ops).map(([k, v]) => [`${prefix}${cap(k)}`, v])
    ) as PrefixedSandboxOps<P, TOptions>;
  }
}
