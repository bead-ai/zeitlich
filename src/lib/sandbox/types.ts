// ============================================================================
// Sandbox Filesystem
// ============================================================================

export interface DirentEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

export interface FileStat {
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  size: number;
  mtime: Date;
}

// ============================================================================
// Network & lifecycle
// ============================================================================

export interface SandboxNetworkConfig {
  allowOut?: string[];
  denyOut?: string[];
  allowPublicTraffic?: boolean;
}

export interface SandboxLifecycleConfig {
  onTimeout: "kill" | "pause";
  autoResume?: boolean;
}

/**
 * Provider-agnostic filesystem interface.
 *
 * Implementations that don't support a method should throw
 * {@link SandboxNotSupportedError}.
 */
export interface SandboxFileSystem {
  /** Base directory used when resolving relative paths. */
  readonly workspaceBase: string;
  readFile(path: string): Promise<string>;
  readFileBuffer(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  appendFile(path: string, content: string | Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileStat>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(path: string): Promise<string[]>;
  readdirWithFileTypes(path: string): Promise<DirentEntry[]>;
  rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean }
  ): Promise<void>;
  cp(
    src: string,
    dest: string,
    options?: { recursive?: boolean }
  ): Promise<void>;
  mv(src: string, dest: string): Promise<void>;
  readlink(path: string): Promise<string>;
  resolvePath(base: string, path: string): string;
}

// ============================================================================
// Execution
// ============================================================================

export interface ExecOptions {
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

// ============================================================================
// Capabilities
// ============================================================================

export interface SandboxCapabilities {
  /** Sandbox supports filesystem operations */
  filesystem: boolean;
  /** Sandbox supports shell/command execution */
  execution: boolean;
  /** Sandbox state can be persisted and restored */
  persistence: boolean;
}

// ============================================================================
// Sandbox
// ============================================================================

export interface Sandbox {
  readonly id: string;
  readonly capabilities: SandboxCapabilities;
  readonly fs: SandboxFileSystem;

  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  destroy(): Promise<void>;
}

// ============================================================================
// Snapshots
// ============================================================================

export interface SandboxSnapshot {
  sandboxId: string;
  providerId: string;
  /** Provider-specific serialised state */
  data: unknown;
  createdAt: string;
}

// ============================================================================
// Provider
// ============================================================================

export interface SandboxCreateOptions {
  /** Preferred sandbox ID (provider may ignore) */
  id?: string;
  /** Seed the filesystem with these files */
  initialFiles?: Record<string, string | Uint8Array>;
  /** Environment variables available inside the sandbox */
  env?: Record<string, string>;
  /** Key-value metadata surfaced via provider list/query APIs */
  metadata?: Record<string, string>;
  /** Sandbox idle timeout in milliseconds */
  timeoutMs?: number;
  /** Enable or disable outbound internet access */
  allowInternetAccess?: boolean;
  /** Outbound network allow/deny rules */
  network?: SandboxNetworkConfig;
  /** Sandbox timeout behaviour */
  lifecycle?: SandboxLifecycleConfig;
}

export interface SandboxCreateResult {
  sandbox: Sandbox;
}

export interface SandboxProvider<
  TOptions extends SandboxCreateOptions = SandboxCreateOptions,
  TSandbox extends Sandbox = Sandbox,
> {
  readonly id: string;
  readonly capabilities: SandboxCapabilities;

  create(options?: TOptions): Promise<SandboxCreateResult>;
  get(sandboxId: string): Promise<TSandbox>;
  destroy(sandboxId: string): Promise<void>;
  pause(sandboxId: string, ttlSeconds?: number): Promise<void>;
  /** Resume a paused sandbox. No-op if already running. */
  resume(sandboxId: string): Promise<void>;
  /**
   * Capture a snapshot of a running sandbox. `options` is a per-call override
   * merged on top of the provider's static defaults.
   */
  snapshot(sandboxId: string, options?: TOptions): Promise<SandboxSnapshot>;
  /**
   * Restore a sandbox from a snapshot. `options` is a per-call override
   * merged on top of the provider's static defaults.
   */
  restore(snapshot: SandboxSnapshot, options?: TOptions): Promise<Sandbox>;
  /** Delete a previously captured snapshot. No-op if already deleted. */
  deleteSnapshot(snapshot: SandboxSnapshot): Promise<void>;
  /**
   * Fork a running sandbox into a new one. `options` is a per-call override
   * merged on top of the provider's static defaults.
   */
  fork(sandboxId: string, options?: TOptions): Promise<Sandbox>;
}

// ============================================================================
// SandboxOps — workflow-side activity interface (like ThreadOps)
// ============================================================================

export interface SandboxOps<
  TOptions extends SandboxCreateOptions = SandboxCreateOptions,
  TCtx = unknown,
> {
  createSandbox(
    options?: TOptions,
    ctx?: TCtx
  ): Promise<{ sandboxId: string } | null>;
  destroySandbox(sandboxId: string): Promise<void>;
  pauseSandbox(sandboxId: string): Promise<void>;
  /** Resume a paused sandbox. No-op if already running. */
  resumeSandbox(sandboxId: string): Promise<void>;
  /** Capture a snapshot. `options` is a per-call override merged on top of provider defaults. */
  snapshotSandbox(
    sandboxId: string,
    options?: TOptions
  ): Promise<SandboxSnapshot>;
  /** Create a fresh sandbox from a snapshot. `options` is a per-call override merged on top of provider defaults. */
  restoreSandbox(
    snapshot: SandboxSnapshot,
    options?: TOptions
  ): Promise<string>;
  /** Delete a previously captured snapshot. No-op if already deleted. */
  deleteSandboxSnapshot(snapshot: SandboxSnapshot): Promise<void>;
  /** Fork a running sandbox. `options` is a per-call override merged on top of provider defaults. */
  forkSandbox(sandboxId: string, options?: TOptions): Promise<string>;
}

/**
 * Maps generic {@link SandboxOps} method names to adapter-prefixed names.
 *
 * @example
 * ```typescript
 * type InMemOps = PrefixedSandboxOps<"inMemory">;
 * // → { inMemoryCreateSandbox, inMemoryDestroySandbox, inMemorySnapshotSandbox }
 * ```
 */
export type PrefixedSandboxOps<
  TPrefix extends string,
  TOptions extends SandboxCreateOptions = SandboxCreateOptions,
  TCtx = unknown,
> = {
  [K in keyof SandboxOps<
    TOptions,
    TCtx
  > as `${TPrefix}${Capitalize<K & string>}`]: SandboxOps<TOptions, TCtx>[K];
};

// ============================================================================
// Errors
// ============================================================================

import { ApplicationFailure } from "@temporalio/common";

export class SandboxNotSupportedError extends ApplicationFailure {
  constructor(operation: string) {
    super(
      `Sandbox does not support: ${operation}`,
      "SandboxNotSupportedError",
      true
    );
  }
}

export class SandboxNotFoundError extends ApplicationFailure {
  constructor(sandboxId: string) {
    super(`Sandbox not found: ${sandboxId}`, "SandboxNotFoundError", true);
  }
}
