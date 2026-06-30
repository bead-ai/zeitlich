// ============================================================================
// Thread lifecycle
// ============================================================================

/**
 * Thread initialization strategy.
 *
 * - `"new"` — start a fresh thread (optionally specify its ID).
 * - `"continue"` — append directly to an existing thread in-place.
 * - `"fork"` — copy all messages from an existing thread into a new one and
 *   continue there. When the adapter has `onForkPrepareThread` and/or
 *   `onForkTransform` hooks configured, they are applied once to the forked
 *   thread before the session starts.
 *
 *   The optional `truncateAfterFork.fromMessageId` directs the session to
 *   call `truncateThread` on the freshly forked thread immediately after
 *   the fork, dropping that message and everything after. Used by
 *   subagents that fork their parent's thread mid-tool-call to strip the
 *   orphan assistant `tool_use` block (the one whose `tool_result` will
 *   never arrive in the child's thread) so the first model call doesn't
 *   reject on an unmatched tool-use/tool-result pair.
 */
export type ThreadInit =
  | { mode: "new"; threadId?: string }
  | { mode: "continue"; threadId: string }
  | {
      mode: "fork";
      threadId: string;
      truncateAfterFork?: { fromMessageId: string };
    };

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

// ============================================================================
// Browser session lifecycle
// ============================================================================

/**
 * Browser-session initialization strategy.
 *
 * Browser providers are minimal-cap (no fork/snapshot/pause), so the supported
 * modes are intentionally limited:
 *
 * - `"new"` — create a fresh browser session. Optionally pass `ctx` to have
 *   the provider's `onPreCreate` hook derive creation options.
 * - `"continue"` — take ownership of an existing, still-running session by id.
 *   The shutdown policy applies on exit.
 * - `"inherit"` — use a session owned by someone else (e.g. a parent agent).
 *   The session will **not** be torn down on exit.
 */
export type BrowserInit =
  | { mode: "new"; ctx?: unknown }
  | { mode: "continue"; browserSessionId: string }
  | { mode: "inherit"; browserSessionId: string };

/**
 * What to do with the browser session when the owning session exits.
 *
 * - `"destroy"` — stop the browser session entirely (default).
 * - `"keep"` — leave the session running (no-op on exit).
 */
export type BrowserShutdown = "destroy" | "keep";
