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
  /** Sandbox idle timeout in milliseconds */
  timeoutMs?: number;
  /**
   * If set, every call to `provider.get(sandboxId)` extends the sandbox
   * lifetime to at least this many milliseconds, refreshing the timeout
   * on each tool invocation. The default `timeoutMs` then acts as a
   * kill-on-abandon safety net rather than a hard cap on run length.
   *
   * E2B's `Sandbox.connect(sandboxId, { timeoutMs })` only extends the
   * lifetime when the new value is longer than the time remaining, so
   * setting this is safe when sessions are still active and idempotent
   * when they aren't.
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
  /** Sandbox idle timeout in milliseconds — overrides the provider default */
  timeoutMs?: number;
  /**
   * Per-create override for the keep-alive refresh window applied on every
   * `provider.get(sandboxId)` call. See {@link E2bSandboxConfig.keepAliveMs}
   * for the full pattern.
   */
  keepAliveMs?: number;
}
