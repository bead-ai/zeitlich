import type { ManagedResource, ResourceCapability } from "./types";

/**
 * Capability-gated method names shared by every resource provider, paired with
 * the {@link ResourceCapability} that must be declared for each. Used by
 * {@link assertCapabilityRuntimeConsistency} to assert that, for each gated
 * method physically present on a provider, the matching capability is also
 * declared in `supportedCapabilities` (and vice-versa) — the runtime half of
 * the type<->runtime alignment guard the type system can't enforce alone.
 */
export const CAP_METHOD_TO_CAPABILITY: ReadonlyArray<{
  method: string;
  capability: ResourceCapability;
}> = [
  { method: "pause", capability: "pause" },
  { method: "resume", capability: "resume" },
  { method: "snapshot", capability: "snapshot" },
  { method: "deleteSnapshot", capability: "snapshot" },
  { method: "restore", capability: "restore" },
  { method: "fork", capability: "fork" },
];

/**
 * Verifies that a provider's runtime `supportedCapabilities` set is consistent
 * with the gated methods physically present on it.
 *
 * Belt-and-suspenders complement to the type-level
 * `ReadonlySet<TCaps & ResourceCapability>` constraint: TypeScript can prevent
 * the runtime set from containing capabilities not declared in `TCaps`, but it
 * cannot detect a provider that **declares** a cap and forgets to include it in
 * the runtime set (or that ships a method without listing its cap). Both shapes
 * silently break activity registration, so we trip a loud failure at
 * construction time instead.
 *
 * Adapters that derive both surfaces from a single `as const` capability array
 * (the recommended pattern) pass this check by construction.
 */
export function assertCapabilityRuntimeConsistency(provider: {
  readonly id: string;
  readonly supportedCapabilities: ReadonlySet<ResourceCapability>;
}): void {
  const supported = provider.supportedCapabilities;
  const probe = provider as unknown as Record<string, unknown>;
  for (const { method, capability } of CAP_METHOD_TO_CAPABILITY) {
    const hasMethod = typeof probe[method] === "function";
    const declaresCap = supported.has(capability);
    if (hasMethod && !declaresCap) {
      throw new Error(
        `Resource provider "${provider.id}" implements ${method}() but ` +
          `does not list "${capability}" in supportedCapabilities. ` +
          `Add the capability to the provider's runtime set so activities ` +
          `for it can be registered.`
      );
    }
    if (declaresCap && !hasMethod) {
      throw new Error(
        `Resource provider "${provider.id}" lists "${capability}" in ` +
          `supportedCapabilities but does not implement ${method}(). ` +
          `Either add the method to the provider or remove the capability ` +
          `from supportedCapabilities.`
      );
    }
  }
}

/**
 * Result returned by {@link ResourceManagerHooks.onPreCreate}.
 *
 * - Set `skip: true` to prevent resource creation entirely.
 * - Set `modifiedOptions` to override/extend the creation options forwarded to
 *   the provider. Fields are merged on top of the original options.
 */
export interface PreCreateHookResult<TOptions = unknown> {
  skip?: boolean;
  modifiedOptions?: Partial<TOptions>;
}

/**
 * Lifecycle hooks for a resource manager.
 *
 * Hooks run inside the existing `create*` activity — no additional activity
 * registration required.
 */
export interface ResourceManagerHooks<
  TOptions = unknown,
  TCtx = unknown,
  TResource extends ManagedResource = ManagedResource,
> {
  /**
   * Called before resource creation.
   *
   * Receives the provider options and an opaque `ctx` value set from the
   * workflow's init. Return `{ skip: true }` to prevent creation, or
   * `{ modifiedOptions }` to alter the options before they reach the provider.
   */
  onPreCreate?: (
    options: TOptions,
    ctx: TCtx
  ) => Promise<PreCreateHookResult<TOptions> | undefined>;

  /**
   * Called after a resource has been successfully created. Receives the live
   * resource instance so the hook can run setup, seed state, or capture
   * identifiers without an extra `provider.get()` round-trip.
   */
  onPostCreate?: (resource: TResource, ctx: TCtx) => Promise<void>;
}
