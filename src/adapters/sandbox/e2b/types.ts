import type { Sandbox, SandboxCreateOptions } from "../../../lib/sandbox/types";
import type { E2bSandboxFileSystem } from "./filesystem";

/**
 * An E2B-backed {@link Sandbox} with its typed filesystem.
 */
export type E2bSandbox = Sandbox & { fs: E2bSandboxFileSystem };

/**
 * Provider-level defaults for E2B sandboxes. Every lifecycle op
 * (`create` / `restore` / `fork`) merges per-call options on top of these —
 * per-call options win per-field. This is how E2B preserves sandbox-level
 * config (network policy, metadata, lifecycle, timeout) across
 * snapshot/restore and fork, since the E2B API treats those as pure
 * create-time inputs that aren't carried in the snapshot blob.
 */
export interface E2bSandboxConfig {
  /** Sandbox template name or ID */
  template?: string;
  /** Default working directory inside the sandbox */
  workspaceBase?: string;
  /**
   * Sandbox lifetime in milliseconds. Despite the name, this is **not** an
   * idle timeout: E2B kills the sandbox once this many milliseconds elapse
   * from creation regardless of activity. Pair with {@link keepAliveMs} to
   * refresh the lifetime on every `provider.get()` call so that this value
   * acts as a kill-on-abandon safety net rather than a hard cap on run
   * length.
   */
  timeoutMs?: number;
  /**
   * If set, every call to `provider.get(sandboxId)` passes
   * `{ timeoutMs: keepAliveMs }` to `Sandbox.connect()`, refreshing the
   * sandbox lifetime on each tool invocation. The provider-level
   * `timeoutMs` then acts as a kill-on-abandon safety net rather than a
   * hard cap on run length.
   *
   * E2B's `Sandbox.connect()` is monotonic for running sandboxes: per the
   * SDK's `SandboxConnectOpts.timeoutMs` doc, "the timeout will update
   * only if the new timeout is longer than the existing one". Pick
   * `keepAliveMs` as the full per-call refresh window you want; passing a
   * value smaller than the time remaining is a no-op rather than a
   * shrink. (If you ever need to shrink, use `Sandbox.setTimeout` /
   * `SandboxApi.setTimeout`, which can extend or reduce.)
   *
   * Per-sandbox overrides are intentionally not exposed — this is a
   * provider-level config only. Every sandbox managed by the provider
   * refreshes by the same amount on each `get()`.
   */
  keepAliveMs?: number;
  /** Default outbound internet access policy */
  allowInternetAccess?: boolean;
  /** Default outbound network allow/deny rules */
  network?: SandboxCreateOptions["network"];
  /** Default metadata surfaced via provider list/query APIs */
  metadata?: SandboxCreateOptions["metadata"];
  /** Default sandbox timeout behaviour */
  lifecycle?: SandboxCreateOptions["lifecycle"];
}

export interface E2bSandboxCreateOptions extends SandboxCreateOptions {
  /** Sandbox template name or ID — overrides the provider default */
  template?: string;
  /**
   * Sandbox lifetime in milliseconds — overrides the provider default. See
   * {@link E2bSandboxConfig.timeoutMs} for the full semantics; pair with
   * the provider-level `keepAliveMs` to refresh on every `provider.get()`
   * call.
   */
  timeoutMs?: number;
}
