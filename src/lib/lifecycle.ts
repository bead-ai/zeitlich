// ============================================================================
// Thread lifecycle
// ============================================================================

/**
 * Thread initialization strategy.
 *
 * - `"new"` — start a fresh thread (optionally specify its ID).
 * - `"continue"` — append directly to an existing thread in-place.
 * - `"fork"` — copy all messages from an existing thread into a new one and
 *   continue there.
 */
export type ThreadInit =
  | { mode: "new"; threadId?: string }
  | { mode: "continue"; threadId: string }
  | { mode: "fork"; threadId: string };

// ============================================================================
// Sandbox lifecycle
// ============================================================================

/**
 * Sandbox initialization strategy.
 *
 * - `"new"` — create a fresh sandbox. Optionally pass `resolverContext` to
 *   have the {@link SandboxManager}'s resolver produce creation options
 *   (e.g. initial files) from workflow arguments.
 * - `"continue"` — resume a previously-paused sandbox (this session takes
 *   ownership and the shutdown policy applies on exit).
 * - `"fork"` — fork from an existing (or paused) sandbox; a new sandbox is
 *   created and owned by this session.
 * - `"inherit"` — use a sandbox owned by someone else (e.g. a parent agent).
 *   The session will **not** manage its lifecycle on exit.
 */
export type SandboxInit =
  | { mode: "new"; resolverContext?: unknown }
  | { mode: "continue"; sandboxId: string }
  | { mode: "fork"; sandboxId: string }
  | { mode: "inherit"; sandboxId: string; stateUpdate?: Record<string, unknown> };

/**
 * What to do with the sandbox when the session exits.
 *
 * - `"destroy"` — tear down the sandbox entirely.
 * - `"pause"` — pause the sandbox so it can be resumed later.
 * - `"keep"` — leave the sandbox running (no-op on exit).
 */
export type SandboxShutdown = "destroy" | "pause" | "keep";

/**
 * Extended shutdown options available to subagent workflows.
 *
 * Includes all base {@link SandboxShutdown} values plus:
 * - `"pause-until-parent-close"` — pause the sandbox on exit, then wait for
 *   the parent workflow to signal when to destroy it.
 */
export type SubagentSandboxShutdown =
  | SandboxShutdown
  | "pause-until-parent-close";
