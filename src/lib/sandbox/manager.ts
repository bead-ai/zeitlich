import type {
  Sandbox,
  SandboxCreateOptions,
  SandboxOps,
  PrefixedSandboxOps,
  SandboxProvider,
  SandboxSnapshot,
} from "./types";

/**
 * Result returned by {@link SandboxManagerHooks.onPreCreate}.
 *
 * - Set `skip: true` to prevent sandbox creation entirely.
 * - Set `modifiedOptions` to override/extend the creation options that will
 *   be forwarded to the provider. Fields in `modifiedOptions` are merged on
 *   top of the original options (`initialFiles` and `env` are shallow-merged;
 *   everything else is overwritten).
 */
export interface PreCreateHookResult<
  TOptions extends SandboxCreateOptions = SandboxCreateOptions,
> {
  skip?: boolean;
  modifiedOptions?: Partial<TOptions>;
}

/**
 * Lifecycle hooks for {@link SandboxManager}.
 *
 * Hooks run inside the existing `createSandbox` activity — no additional
 * activity registration required.
 */
export interface SandboxManagerHooks<
  TOptions extends SandboxCreateOptions = SandboxCreateOptions,
> {
  /**
   * Called before sandbox creation.
   *
   * Receives the raw options (including `ctx` when passed from
   * the workflow). Return `{ skip: true }` to prevent creation, or
   * `{ modifiedOptions }` to alter the options before they reach the
   * provider.
   */
  onPreCreate?: (
    options: TOptions | undefined
  ) => Promise<PreCreateHookResult<TOptions> | undefined>;

  /**
   * Called after a sandbox has been successfully created.
   */
  onPostCreate?: (sandboxId: string) => Promise<void>;
}

/**
 * Stateless facade over a {@link SandboxProvider}.
 *
 * Delegates all lifecycle operations to the provider, which is responsible
 * for its own instance management strategy (e.g. in-memory map, remote API).
 *
 * Optional {@link SandboxManagerHooks} can be passed at construction time.
 * The `onPreCreate` hook runs inside the `createSandbox` activity, giving it
 * access to `ctx` from workflow arguments without an extra
 * activity. It can modify options or skip creation entirely.
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
 *     hooks: {
 *       onPreCreate: async (options) => {
 *         const { projectId, filePaths } = options?.ctx as { projectId: string; filePaths: string[] };
 *         const files: Record<string, string> = {};
 *         for (const p of filePaths) files[p] = await db.readFile(projectId, p);
 *         return { modifiedOptions: { initialFiles: files } };
 *       },
 *       onPostCreate: async (sandboxId) => {
 *         console.log("Sandbox created:", sandboxId);
 *       },
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
  private hooks: SandboxManagerHooks<TOptions>;

  constructor(
    private provider: SandboxProvider<TOptions, TSandbox> & {
      readonly id: TId;
    },
    options?: { hooks?: SandboxManagerHooks<TOptions> }
  ) {
    this.hooks = options?.hooks ?? {};
  }

  async create(options?: TOptions): Promise<{
    sandboxId: string;
    stateUpdate?: Record<string, unknown>;
  } | null> {
    let providerOptions = options;

    if (this.hooks.onPreCreate) {
      const hookResult = await this.hooks.onPreCreate(options);
      if (hookResult?.skip) return null;

      if (hookResult?.modifiedOptions) {
        const orig = options ?? ({} as TOptions);
        const mod = hookResult.modifiedOptions;
        providerOptions = {
          ...mod,
          ...orig,
          initialFiles: {
            ...mod.initialFiles,
            ...orig.initialFiles,
          },
          env: {
            ...mod.env,
            ...orig.env,
          },
        } as TOptions;
      }
    }

    if (providerOptions?.ctx !== undefined) {
      const { ctx: _rc, ...passthrough } = providerOptions;
      providerOptions = passthrough as TOptions;
    }

    const { sandbox, stateUpdate } =
      await this.provider.create(providerOptions);

    if (this.hooks.onPostCreate) {
      await this.hooks.onPostCreate(sandbox.id);
    }

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
      } | null> => {
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
