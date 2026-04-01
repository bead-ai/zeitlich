import type {
  FileEntryMetadata,
  FileResolver,
  PrefixedVirtualFsOps,
  VirtualFsOps,
} from "./types";

/**
 * Creates prefixed Temporal activity functions for a {@link FileResolver}.
 *
 * Pair with {@link proxyVirtualFsOps} on the workflow side using the same
 * scope string.
 *
 * @param resolver - Consumer-provided bridge to DB / S3 / CRUD layer
 * @param scope    - Workflow name used to namespace the activities
 *
 * @example
 * ```typescript
 * import { createVirtualFsActivities } from 'zeitlich';
 *
 * const activities = {
 *   ...createVirtualFsActivities(resolver, "CodingAgent"),
 * };
 * // registers: codingAgentResolveFileTree
 * ```
 */
export function createVirtualFsActivities<
  S extends string,
  TCtx = unknown,
  TMeta = FileEntryMetadata,
>(
  resolver: FileResolver<TCtx, TMeta>,
  scope: S
): PrefixedVirtualFsOps<S, TCtx, TMeta> {
  const ops: VirtualFsOps<TCtx, TMeta> = {
    resolveFileTree: async (ctx: TCtx) => {
      const fileTree = await resolver.resolveEntries(ctx);
      return { fileTree };
    },
  };

  const prefix = `virtualFs${scope.charAt(0).toUpperCase()}${scope.slice(1)}`;
  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

  return Object.fromEntries(
    Object.entries(ops).map(([k, v]) => [`${prefix}${cap(k)}`, v])
  ) as PrefixedVirtualFsOps<S, TCtx, TMeta>;
}
