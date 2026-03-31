import type {
  Sandbox,
  SandboxCreateOptions,
  SandboxOps,
  PrefixedSandboxOps,
  SandboxProvider,
  SandboxSnapshot,
} from "./types";

/**
 * Async resolver that turns an opaque `resolverContext` into partial
 * creation options (e.g. initial files loaded from an external data source).
 *
 * Registered once on the {@link SandboxManager} and invoked automatically
 * inside the `createSandbox` activity when `resolverContext` is present —
 * no additional activity registration required.
 */
export type SandboxCreateResolver<
  TOptions extends SandboxCreateOptions = SandboxCreateOptions,
> = (ctx: unknown) => Promise<Partial<TOptions>>;

/**
 * Stateless facade over a {@link SandboxProvider}.
 *
 * Delegates all lifecycle operations to the provider, which is responsible
 * for its own instance management strategy (e.g. in-memory map, remote API).
 *
 * An optional {@link SandboxCreateResolver} can be passed at construction time.
 * When the `createSandbox` activity receives a `resolverContext`, the resolver
 * is called and its output is merged into the creation options before they
 * reach the provider. This allows workflows to derive sandbox options (e.g.
 * initial files) from workflow arguments without an extra activity.
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
 *
 * @example
 * ```typescript
 * const manager = new SandboxManager(
 *   new DaytonaSandboxProvider(config),
 *   {
 *     resolver: async (ctx) => {
 *       const { projectId, filePaths } = ctx as { projectId: string; filePaths: string[] };
 *       const files: Record<string, string> = {};
 *       for (const p of filePaths) files[p] = await db.readFile(projectId, p);
 *       return { initialFiles: files };
 *     },
 *   },
 * );
 * ```
 */
export class SandboxManager<
  TOptions extends SandboxCreateOptions = SandboxCreateOptions,
  TSandbox extends Sandbox = Sandbox,
  TId extends string = string,
> {
  private resolver?: SandboxCreateResolver<TOptions>;

  constructor(
    private provider: SandboxProvider<TOptions, TSandbox> & { readonly id: TId },
    options?: { resolver?: SandboxCreateResolver<TOptions> },
  ) {
    this.resolver = options?.resolver;
  }

  async create(
    options?: TOptions
  ): Promise<{ sandboxId: string; stateUpdate?: Record<string, unknown> }> {
    let providerOptions = options;

    if (options?.resolverContext !== undefined && this.resolver) {
      const resolved = await this.resolver(options.resolverContext);

      const { resolverContext: _rc, ...passthrough } = options;
      providerOptions = {
        ...resolved,
        ...passthrough,
        initialFiles: {
          ...resolved.initialFiles,
          ...passthrough.initialFiles,
        },
        env: {
          ...resolved.env,
          ...passthrough.env,
        },
      } as TOptions;
    } else if (options?.resolverContext !== undefined) {
      const { resolverContext: _rc2, ...passthrough } = options;
      providerOptions = passthrough as TOptions;
    }

    const { sandbox, stateUpdate } = await this.provider.create(providerOptions);
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
   * const dmgr = new SandboxManager(new DaytonaSandboxProvider(config));
   * dmgr.createActivities("CodingAgent");
   * // registers: daytonaCodingAgentCreateSandbox, …
   * ```
   */
  createActivities<S extends string>(
    scope: S
  ): PrefixedSandboxOps<`${TId}${Capitalize<S>}`, TOptions> {
    const prefix = `${this.provider.id}${scope.charAt(0).toUpperCase()}${scope.slice(1)}`;
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
      pauseSandbox: async (
        sandboxId: string,
        ttlSeconds?: number
      ): Promise<void> => {
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
    ) as PrefixedSandboxOps<`${TId}${Capitalize<S>}`, TOptions>;
  }
}
