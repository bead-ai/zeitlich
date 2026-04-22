// ============================================================================
// Thread lifecycle
// ============================================================================

/**
 * Thread initialization strategy.
 *
 * - `"new"` — start a fresh thread (optionally specify its ID).
 * - `"continue"` — append directly to an existing thread in-place.
 * - `"fork"` — copy all messages from an existing thread into a new one and
 *   continue there. When `transform` is `true`, the adapter's
 *   `onForkPrepareThread` and/or `onForkTransform` hooks are applied once to
 *   the forked thread before the session starts.
 */
export type ThreadInit =
  | { mode: "new"; threadId?: string }
  | { mode: "continue"; threadId: string }
  | { mode: "fork"; threadId: string; transform?: boolean };

// ============================================================================
// Sandbox lifecycle
// ============================================================================

import type { SandboxCreateOptions, SandboxSnapshot } from "./sandbox/types";

/**
 * Sandbox initialization strategy.
 *
 * - `"new"` — create a fresh sandbox. Optionally pass `ctx` to
 *   have the {@link SandboxManager}'s resolver produce creation options
 *   (e.g. initial files) from workflow arguments.
 * - `"continue"` — take ownership of an existing sandbox (paused or running).
 *   Paused sandboxes are automatically resumed. The shutdown policy applies
 *   on exit.
 * - `"fork"` — fork from an existing (or paused) sandbox; a new sandbox is
 *   created and owned by this session. `options` is an optional per-call
 *   override merged on top of the provider's static defaults.
 * - `"from-snapshot"` — restore a fresh sandbox from a previously captured
 *   {@link SandboxSnapshot}. The new sandbox is owned by this session.
 *   `options` is an optional per-call override merged on top of the
 *   provider's static defaults.
 * - `"inherit"` — use a sandbox owned by someone else (e.g. a parent agent).
 *   The session will **not** manage its lifecycle on exit.
 */
export type SandboxInit =
  | { mode: "new"; ctx?: unknown }
  | { mode: "continue"; sandboxId: string }
  | { mode: "fork"; sandboxId: string; options?: SandboxCreateOptions }
  | {
      mode: "from-snapshot";
      snapshot: SandboxSnapshot;
      options?: SandboxCreateOptions;
    }
  | {
      mode: "inherit";
      sandboxId: string;
    };

/**
 * What to do with the sandbox when the session exits.
 *
 * - `"destroy"` — tear down the sandbox entirely.
 * - `"pause"` — pause the sandbox so it can be resumed later.
 * - `"keep"` — leave the sandbox running (no-op on exit).
 * - `"snapshot"` — capture a snapshot then destroy the sandbox. The snapshot
 *   is surfaced on the session result so the caller can reuse it to spawn
 *   future sandboxes.
 */
export type SandboxShutdown = "destroy" | "pause" | "keep" | "snapshot";

/**
 * Extended shutdown options available to subagent workflows.
 *
 * Includes all base {@link SandboxShutdown} values plus:
 * - `"pause-until-parent-close"` — pause the sandbox on exit, then wait for
 *   the parent workflow to signal when to destroy it.
 * - `"keep-until-parent-close"` — leave the sandbox running on exit, then
 *   wait for the parent workflow to signal when to destroy it.
 */
export type SubagentSandboxShutdown =
  | SandboxShutdown
  | "pause-until-parent-close"
  | "keep-until-parent-close";
