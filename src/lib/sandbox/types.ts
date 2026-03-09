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

/**
 * Provider-agnostic filesystem interface.
 *
 * Implementations that don't support a method should throw
 * {@link SandboxNotSupportedError}.
 */
export interface SandboxFileSystem {
  readFile(path: string): Promise<string>;
  readFileBuffer(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  appendFile(path: string, content: string | Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileStat>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(path: string): Promise<string[]>;
  readdirWithFileTypes(path: string): Promise<DirentEntry[]>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  cp(src: string, dest: string, options?: { recursive?: boolean }): Promise<void>;
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
}

export interface SandboxCreateResult {
  sandbox: Sandbox;
  /** Optional state to merge into the workflow's `AgentState` via the session. */
  stateUpdate?: Record<string, unknown>;
}

export interface SandboxProvider<
  TOptions extends SandboxCreateOptions = SandboxCreateOptions,
> {
  readonly id: string;
  readonly capabilities: SandboxCapabilities;

  create(options?: TOptions): Promise<SandboxCreateResult>;
  get(sandboxId: string): Promise<Sandbox>;
  destroy(sandboxId: string): Promise<void>;
  snapshot(sandboxId: string): Promise<SandboxSnapshot>;
  restore(snapshot: SandboxSnapshot): Promise<Sandbox>;
}

// ============================================================================
// SandboxOps — workflow-side activity interface (like ThreadOps)
// ============================================================================

export interface SandboxOps<
  TOptions extends SandboxCreateOptions = SandboxCreateOptions,
> {
  createSandbox(
    options?: TOptions,
  ): Promise<{ sandboxId: string; stateUpdate?: Record<string, unknown> }>;
  destroySandbox(sandboxId: string): Promise<void>;
  snapshotSandbox(sandboxId: string): Promise<SandboxSnapshot>;
}

// ============================================================================
// Errors
// ============================================================================

import { ApplicationFailure } from "@temporalio/common";

export class SandboxNotSupportedError extends ApplicationFailure {
  constructor(operation: string) {
    super(
      `Sandbox does not support: ${operation}`,
      "SandboxNotSupportedError",
      true,
    );
  }
}

export class SandboxNotFoundError extends ApplicationFailure {
  constructor(sandboxId: string) {
    super(`Sandbox not found: ${sandboxId}`, "SandboxNotFoundError", true);
  }
}
