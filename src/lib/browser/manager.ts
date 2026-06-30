import type {
  BrowserCreateOptions,
  BrowserSession,
  BrowserSessionOps,
  BrowserSessionProvider,
  PrefixedBrowserSessionOps,
} from "./types";
import { assertCapabilityRuntimeConsistency } from "../resource/manager";
import type { ResourceManagerHooks } from "../resource/manager";

/**
 * Lifecycle hooks for {@link BrowserSessionManager}. Browser specialization of
 * the generic {@link ResourceManagerHooks}: `onPostCreate` receives a live
 * {@link BrowserSession}.
 */
export type BrowserSessionManagerHooks<
  TOptions extends BrowserCreateOptions = BrowserCreateOptions,
  TCtx = unknown,
> = ResourceManagerHooks<TOptions, TCtx, BrowserSession>;

/**
 * Stateless facade over a {@link BrowserSessionProvider}, mirroring
 * `SandboxManager`. Wraps the provider's base lifecycle (`create`/`get`/
 * `destroy`) and exposes prefixed Temporal activities via
 * {@link BrowserSessionManager.createActivities}.
 *
 * Browser providers are minimal-cap (no pause/resume/snapshot/fork), so there
 * are no capability-gated activities — only `create*Browser`/`destroy*Browser`.
 *
 * @example
 * ```typescript
 * const manager = new BrowserSessionManager(new AgentCoreBrowserProvider(cfg));
 * const activities = {
 *   ...manager.createActivities("WebAgent"),
 *   browserNavigate: withBrowser(manager, navigateHandler),
 * };
 * // registers: agentcoreBrowserWebAgentCreateBrowser, …DestroyBrowser
 * ```
 */
export class BrowserSessionManager<
  TOptions extends BrowserCreateOptions = BrowserCreateOptions,
  TSession extends BrowserSession = BrowserSession,
  TId extends string = string,
  TCtx = unknown,
> {
  private hooks: BrowserSessionManagerHooks<TOptions, TCtx>;

  constructor(
    private provider: BrowserSessionProvider<TOptions, TSession> & {
      readonly id: TId;
    },
    options?: { hooks?: BrowserSessionManagerHooks<TOptions, TCtx> }
  ) {
    this.hooks = options?.hooks ?? {};
    assertCapabilityRuntimeConsistency(
      this.provider as unknown as {
        readonly id: string;
        readonly supportedCapabilities: ReadonlySet<never>;
      }
    );
  }

  async create(
    options?: TOptions,
    ctx?: TCtx
  ): Promise<{ browserSessionId: string } | null> {
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
          env: {
            ...mod.env,
            ...orig.env,
          },
        } as TOptions;
      }
    }

    const { session } = await this.provider.create(providerOptions);

    if (this.hooks.onPostCreate) {
      await this.hooks.onPostCreate(session, ctx ?? ({} as TCtx));
    }

    return { browserSessionId: session.id };
  }

  async getBrowserSession(id: string): Promise<TSession> {
    return this.provider.get(id);
  }

  async destroy(id: string): Promise<void> {
    await this.provider.destroy(id);
  }

  /**
   * Returns Temporal activity functions with prefixed names. The provider's
   * `id` is automatically prepended, so you only pass the workflow/scope name.
   * Use the matching `proxy*BrowserOps()` helper on the workflow side.
   *
   * @param scope - Workflow name (appended to the provider id)
   */
  createActivities<S extends string>(
    scope: S
  ): PrefixedBrowserSessionOps<`${TId}${Capitalize<S>}`, TOptions, TCtx> {
    const prefix = `${this.provider.id}${scope.charAt(0).toUpperCase()}${scope.slice(1)}`;
    const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

    const ops: BrowserSessionOps<TOptions, TCtx> = {
      createBrowser: async (
        options?: TOptions,
        ctx?: TCtx
      ): Promise<{ browserSessionId: string } | null> => {
        return this.create(options, ctx);
      },
      destroyBrowser: async (browserSessionId: string): Promise<void> => {
        await this.destroy(browserSessionId);
      },
    };

    return Object.fromEntries(
      Object.entries(ops).map(([k, v]) => [`${prefix}${cap(k)}`, v])
    ) as PrefixedBrowserSessionOps<`${TId}${Capitalize<S>}`, TOptions, TCtx>;
  }
}
