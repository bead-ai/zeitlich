import type {
  Sandbox,
  SandboxCapability,
  SandboxCreateOptions,
  SandboxOps,
  PrefixedSandboxOps,
  SandboxProvider,
  SandboxSnapshot,
} from "./types";
import { SandboxNotSupportedError } from "./types";

/**
 * Method names the manager treats as capability-gated, mirroring the
 * conditional fields on {@link SandboxProvider}. The full list is used
 * by the constructor-time consistency check below to assert that, for
 * each gated method present on the provider at runtime, the matching
 * capability is also declared in `supportedCapabilities` (and vice
 * versa). This is the runtime half of the type↔runtime alignment guard
 * the type-level constraint can't enforce on its own.
 */
const CAP_METHOD_TO_CAPABILITY: ReadonlyArray<{
  method: string;
  capability: SandboxCapability;
}> = [
  { method: "pause", capability: "pause" },
  { method: "resume", capability: "resume" },
  { method: "snapshot", capability: "snapshot" },
  { method: "deleteSnapshot", capability: "snapshot" },
  { method: "restore", capability: "restore" },
  { method: "fork", capability: "fork" },
];

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
  TCtx = unknown,
> {
  /**
   * Called before sandbox creation.
   *
   * Receives the provider options and an opaque `ctx` value set from the
   * workflow's {@link SandboxInit}. Use `ctx` to derive additional creation
   * options (e.g. initial files from workflow arguments).
   *
   * Return `{ skip: true }` to prevent creation, or `{ modifiedOptions }`
   * to alter the options before they reach the provider.
   */
  onPreCreate?: (
    options: TOptions,
    ctx: TCtx
  ) => Promise<PreCreateHookResult<TOptions> | undefined>;

  /**
   * Called after a sandbox has been successfully created.
   *
   * Receives the live {@link Sandbox} instance so the hook can run setup
   * commands, seed files, or capture identifiers without an extra
   * `provider.get()` round-trip.
   */
  onPostCreate?: (sandbox: Sandbox, ctx: TCtx) => Promise<void>;
}

/**
 * Stateless facade over a {@link SandboxProvider}.
 *
 * Generic over the same capability set (`TCaps`) as the underlying
 * provider. The manager's lifecycle methods are always present on the
 * class (so existing call sites compile unchanged), but
 * {@link SandboxManager.createActivities} is capability-gated: only
 * activities whose capability the provider declares via
 * {@link SandboxProvider.supportedCapabilities} are wrapped, and the
 * returned object's type omits absent ones.
 *
 * The default `TCaps = SandboxCapability` keeps the full method surface
 * for existing usages that only pass `TOptions` / `TSandbox` / `TId`.
 *
 * Optional {@link SandboxManagerHooks} can be passed at construction time.
 * The `onPreCreate` hook runs inside the `createSandbox` activity, receiving
 * the provider options and an opaque `ctx` value from the workflow's
 * {@link SandboxInit}. It can modify options or skip creation entirely.
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
 *       onPreCreate: async (options, ctx) => {
 *         const { projectId, filePaths } = ctx as { projectId: string; filePaths: string[] };
 *         const files: Record<string, string> = {};
 *         for (const p of filePaths) files[p] = await db.readFile(projectId, p);
 *         return { modifiedOptions: { initialFiles: files } };
 *       },
 *       onPostCreate: async (sandbox) => {
 *         console.log("Sandbox created:", sandbox.id);
 *         await sandbox.exec("git init");
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
  TCtx = unknown,
  TCaps extends SandboxCapability = SandboxCapability,
> {
  private hooks: SandboxManagerHooks<TOptions, TCtx>;

  constructor(
    private provider: SandboxProvider<TOptions, TSandbox, TCaps> & {
      readonly id: TId;
    },
    options?: { hooks?: SandboxManagerHooks<TOptions, TCtx> }
  ) {
    this.hooks = options?.hooks ?? {};
    this.assertCapabilityRuntimeConsistency();
  }

  /**
   * Verifies that the provider's runtime `supportedCapabilities` set is
   * consistent with the gated methods physically present on the provider.
   *
   * Belt-and-suspenders complement to the type-level
   * `ReadonlySet<TCaps & SandboxCapability>` constraint: TypeScript can
   * prevent the runtime set from containing capabilities not declared in
   * `TCaps`, but it cannot detect a provider that **declares** a cap in
   * `TCaps` and forgets to include it in the runtime set (or that ships
   * a method without listing its cap). Both shapes silently break
   * activity registration, so we trip a loud failure at construction
   * time instead.
   *
   * Adapters that derive both surfaces from a single `as const`
   * capability array (the recommended pattern) pass this check by
   * construction.
   */
  private assertCapabilityRuntimeConsistency(): void {
    const supported = this.provider
      .supportedCapabilities as ReadonlySet<SandboxCapability>;
    for (const { method, capability } of CAP_METHOD_TO_CAPABILITY) {
      const hasMethod =
        typeof (this.provider as unknown as Record<string, unknown>)[method] ===
        "function";
      const declaresCap = supported.has(capability);
      if (hasMethod && !declaresCap) {
        throw new Error(
          `Sandbox provider "${this.provider.id}" implements ${method}() but ` +
            `does not list "${capability}" in supportedCapabilities. ` +
            `Add the capability to the provider's runtime set so activities ` +
            `for it can be registered.`
        );
      }
      if (declaresCap && !hasMethod) {
        throw new Error(
          `Sandbox provider "${this.provider.id}" lists "${capability}" in ` +
            `supportedCapabilities but does not implement ${method}(). ` +
            `Either add the method to the provider or remove the capability ` +
            `from supportedCapabilities.`
        );
      }
    }
  }

  async create(
    options?: TOptions,
    ctx?: TCtx
  ): Promise<{ sandboxId: string } | null> {
    let providerOptions = options;

    if (this.hooks.onPreCreate) {
      const hookResult = await this.hooks.onPreCreate(
        options ?? ({} as TOptions),
        ctx ?? ({} as TCtx)
      );
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

    const { sandbox } = await this.provider.create(providerOptions);

    if (this.hooks.onPostCreate) {
      await this.hooks.onPostCreate(sandbox, ctx ?? ({} as TCtx));
    }

    return { sandboxId: sandbox.id };
  }

  async getSandbox(id: string): Promise<TSandbox> {
    return this.provider.get(id);
  }

  async destroy(id: string): Promise<void> {
    await this.provider.destroy(id);
  }

  /**
   * Capability-gated lifecycle methods on the underlying provider.
   *
   * These manager methods always exist at runtime; calling one whose
   * capability is absent from the provider's `supportedCapabilities`
   * throws an error. The activities returned from
   * {@link SandboxManager.createActivities} are gated at the type level
   * via `TCaps`, which is where compile-time safety is enforced.
   */
  async pause(id: string, ttlSeconds?: number): Promise<void> {
    const fn = this.providerMethod("pause") as
      | ((id: string, ttlSeconds?: number) => Promise<void>)
      | undefined;
    if (!fn) throw this.unsupported("pause");
    await fn.call(this.provider, id, ttlSeconds);
  }

  async resume(id: string): Promise<void> {
    const fn = this.providerMethod("resume") as
      | ((id: string) => Promise<void>)
      | undefined;
    if (!fn) throw this.unsupported("resume");
    await fn.call(this.provider, id);
  }

  async snapshot(id: string, options?: TOptions): Promise<SandboxSnapshot> {
    const fn = this.providerMethod("snapshot") as
      | ((id: string, options?: TOptions) => Promise<SandboxSnapshot>)
      | undefined;
    if (!fn) throw this.unsupported("snapshot");
    return fn.call(this.provider, id, options);
  }

  async restore(
    snapshot: SandboxSnapshot,
    options?: TOptions
  ): Promise<string> {
    const fn = this.providerMethod("restore") as
      | ((snap: SandboxSnapshot, options?: TOptions) => Promise<TSandbox>)
      | undefined;
    if (!fn) throw this.unsupported("restore");
    const sandbox = await fn.call(this.provider, snapshot, options);
    return sandbox.id;
  }

  async deleteSnapshot(snapshot: SandboxSnapshot): Promise<void> {
    const fn = this.providerMethod("deleteSnapshot") as
      | ((snap: SandboxSnapshot) => Promise<void>)
      | undefined;
    if (!fn) throw this.unsupported("deleteSnapshot");
    await fn.call(this.provider, snapshot);
  }

  async fork(sandboxId: string, options?: TOptions): Promise<string> {
    const fn = this.providerMethod("fork") as
      | ((id: string, options?: TOptions) => Promise<TSandbox>)
      | undefined;
    if (!fn) throw this.unsupported("fork");
    const sandbox = await fn.call(this.provider, sandboxId, options);
    return sandbox.id;
  }

  private providerMethod(name: string): unknown {
    const value = (this.provider as unknown as Record<string, unknown>)[name];
    return typeof value === "function" ? value : undefined;
  }

  /**
   * Constructs the structured error thrown when an unsupported lifecycle
   * method is invoked through the manager. Uses the public
   * {@link SandboxNotSupportedError} symbol so consumers that catch on
   * `instanceof SandboxNotSupportedError` (the documented compatibility
   * path) keep matching after the refactor.
   */
  private unsupported(name: string): SandboxNotSupportedError {
    return new SandboxNotSupportedError(name);
  }

  /**
   * Returns Temporal activity functions with prefixed names.
   *
   * The provider's `id` is automatically prepended, so you only need
   * to pass the workflow/scope name. Use the matching `proxy*SandboxOps()`
   * helper from the adapter's `/workflow` entrypoint on the workflow side.
   *
   * Activities are only registered for capabilities the provider declares
   * via {@link SandboxProvider.supportedCapabilities}: methods omitted
   * from the cap set are not wrapped, and the returned object's type
   * omits the corresponding keys.
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
   * // registers: daytonaCodingAgentCreateSandbox, daytonaCodingAgentDestroySandbox
   * // (snapshot/restore/fork/pause/resume omitted — Daytona doesn't declare them)
   * ```
   */
  createActivities<S extends string>(
    scope: S
  ): PrefixedSandboxOps<`${TId}${Capitalize<S>}`, TOptions, TCtx, TCaps> {
    const prefix = `${this.provider.id}${scope.charAt(0).toUpperCase()}${scope.slice(1)}`;
    const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
    // The set is statically typed against the (possibly narrow) `TCaps`,
    // but we need to probe every well-known capability here. Widen for
    // the duration of the lookup; the constructor-time consistency check
    // already ensures these probes can't accidentally observe a method
    // present on the provider that's missing from the declared set.
    const supported = this.provider
      .supportedCapabilities as ReadonlySet<SandboxCapability>;

    type WideOps = SandboxOps<TOptions, TCtx>;
    const ops: Partial<WideOps> = {
      createSandbox: async (
        options?: TOptions,
        ctx?: TCtx
      ): Promise<{ sandboxId: string } | null> => {
        return this.create(options, ctx);
      },
      destroySandbox: async (sandboxId: string): Promise<void> => {
        await this.destroy(sandboxId);
      },
    };

    if (supported.has("pause")) {
      ops.pauseSandbox = async (
        sandboxId: string,
        ttlSeconds?: number
      ): Promise<void> => {
        await this.pause(sandboxId, ttlSeconds);
      };
    }
    if (supported.has("resume")) {
      ops.resumeSandbox = async (sandboxId: string): Promise<void> => {
        await this.resume(sandboxId);
      };
    }
    if (supported.has("snapshot")) {
      ops.snapshotSandbox = async (
        sandboxId: string,
        options?: TOptions
      ): Promise<SandboxSnapshot> => {
        return this.snapshot(sandboxId, options);
      };
      ops.deleteSandboxSnapshot = async (
        snapshot: SandboxSnapshot
      ): Promise<void> => {
        await this.deleteSnapshot(snapshot);
      };
    }
    if (supported.has("restore")) {
      ops.restoreSandbox = async (
        snapshot: SandboxSnapshot,
        options?: TOptions
      ): Promise<string> => {
        return this.restore(snapshot, options);
      };
    }
    if (supported.has("fork")) {
      ops.forkSandbox = async (
        sandboxId: string,
        options?: TOptions
      ): Promise<string> => {
        return this.fork(sandboxId, options);
      };
    }

    const entries = Object.entries(ops).filter(
      ([, v]) => typeof v === "function"
    );
    return Object.fromEntries(
      entries.map(([k, v]) => [`${prefix}${cap(k)}`, v])
    ) as PrefixedSandboxOps<`${TId}${Capitalize<S>}`, TOptions, TCtx, TCaps>;
  }
}
