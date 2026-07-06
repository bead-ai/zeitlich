/**
 * A hook slot: a single hook function or an array of hook functions run
 * sequentially in order. Chaining semantics are defined per hook by the
 * call site — see {@link Hooks} and ToolRouterHooks docs.
 */
export type HookInput<H> = H | H[];

/** Normalize a hook slot to an array of hooks (empty when undefined). */
export function normalizeHooks<H>(hook: HookInput<H> | undefined): H[] {
  if (hook === undefined) return [];
  return Array.isArray(hook) ? hook : [hook];
}
