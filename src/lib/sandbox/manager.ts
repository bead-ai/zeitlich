import type {
  PrefixedSandboxOps,
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
 *   ...manager.createActivities("CodingAgent"),
 *   bashHandler: withSandbox(manager, bashHandler),
 * };
 * // registers: inMemoryCodingAgentCreateSandbox, …
 * ```
 */
export class SandboxManager<
  TOptions extends SandboxCreateOptions = SandboxCreateOptions,
  TSandbox extends Sandbox = Sandbox,
  TId extends string = string,
> {
  constructor(
    private provider: SandboxProvider<TOptions, TSandbox> & {
      readonly id: TId;
    },
  ) {}

  async create(
    options?: TOptions,
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

  async fork(sandboxId: string): Promise<string> {
    const sandbox = await this.provider.fork(sandboxId);
    return sandbox.id;
  }

  /**
   * Returns Temporal activity functions with prefixed names.
   *
   * The provider's `id` is automatically prepended, so you only need
   * to pass the workflow/scope name. Use the matching `proxy*SandboxOps()`
   * helper from the adapter's `/workflow` entrypoint on the workflow side.
   *
   * @param scope - Workflow name (appended to the provider id)
   *
   * @example
   * ```typescript
   * const manager = new SandboxManager(new InMemorySandboxProvider());
   * manager.createActivities("CodingAgent");
   * // registers: inMemoryCodingAgentCreateSandbox, inMemoryCodingAgentDestroySandbox, …
   *
   * const vmgr = new SandboxManager(new VirtualSandboxProvider(resolver));
   * vmgr.createActivities("CodingAgent");
   * // registers: virtualCodingAgentCreateSandbox, …
   * ```
   */
  createActivities<S extends string>(
    scope: S,
  ): PrefixedSandboxOps<`${TId}${Capitalize<S>}`, TOptions> {
    const prefix = `${this.provider.id}${scope.charAt(0).toUpperCase()}${scope.slice(1)}`;
    const ops: SandboxOps<TOptions> = {
      createSandbox: async (
        options?: TOptions,
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
      forkSandbox: async (sandboxId: string): Promise<string> => {
        return this.fork(sandboxId);
      },
    };
    const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
    return Object.fromEntries(
      Object.entries(ops).map(([k, v]) => [`${prefix}${cap(k)}`, v]),
    ) as PrefixedSandboxOps<`${TId}${Capitalize<S>}`, TOptions>;
  }
}
