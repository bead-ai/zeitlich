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

/**
 * Runtime capability flags carried by a {@link Sandbox} instance.
 *
 * These are an orthogonal mechanism to the type-level
 * {@link SandboxCapability} union: this flag bag is for runtime
 * introspection ("does the sandbox support a filesystem?") whereas
 * {@link SandboxCapability} narrows the type-level provider/ops contract.
 */
export interface SandboxCapabilities {
  /** Sandbox supports filesystem operations */
  filesystem: boolean;
  /** Sandbox supports shell/command execution */
  execution: boolean;
  /** Sandbox state can be persisted and restored */
  persistence: boolean;
}

/**
 * Type-level capability vocabulary for {@link SandboxProvider} and
 * {@link SandboxOps}. Adapters declare the subset they actually support; the
 * conditional types on each contract gate the corresponding methods so
 * unsupported calls become a compile-time error rather than a runtime
 * {@link SandboxNotSupportedError}.
 *
 * `pause` and `resume` are split because some adapters might support one
 * direction without the other. The `snapshot` cap covers both `snapshot()`
 * and `deleteSnapshot()` since they always travel together in practice.
 */
export type SandboxCapability =
  | "pause"
  | "resume"
  | "snapshot"
  | "restore"
  | "fork";

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

/**
 * Internal helper: drop keys whose value is `never` from an object type.
 *
 * Used by the capability-gated contracts below so that an absent capability
 * removes the corresponding key entirely, instead of leaving a required
 * field with type `never` (which would make implementations impossible).
 */
type OmitNever<T> = {
  [K in keyof T as [T[K]] extends [never] ? never : K]: T[K];
};

/**
 * Capability-gated provider lifecycle methods.
 *
 * Each field becomes `never` when its capability is absent from `TCaps`;
 * the wrapping `OmitNever` removes those keys entirely, so the method
 * isn't part of the type surface for adapters that don't support it.
 */
type SandboxProviderCapMethods<
  TOptions extends SandboxCreateOptions,
  TSandbox extends Sandbox,
  TCaps extends SandboxCapability,
> = OmitNever<{
  pause: "pause" extends TCaps
    ? (sandboxId: string, ttlSeconds?: number) => Promise<void>
    : never;
  resume: "resume" extends TCaps ? (sandboxId: string) => Promise<void> : never;
  snapshot: "snapshot" extends TCaps
    ? (sandboxId: string, options?: TOptions) => Promise<SandboxSnapshot>
    : never;
  deleteSnapshot: "snapshot" extends TCaps
    ? (snapshot: SandboxSnapshot) => Promise<void>
    : never;
  restore: "restore" extends TCaps
    ? (snapshot: SandboxSnapshot, options?: TOptions) => Promise<TSandbox>
    : never;
  fork: "fork" extends TCaps
    ? (sandboxId: string, options?: TOptions) => Promise<TSandbox>
    : never;
}>;

/**
 * Always-present provider lifecycle methods. These do not depend on the
 * capability set and are required by every adapter.
 */
interface SandboxProviderBase<
  TOptions extends SandboxCreateOptions,
  TSandbox extends Sandbox,
> {
  readonly id: string;
  readonly capabilities: SandboxCapabilities;
  /**
   * Runtime-introspectable list of supported capabilities.
   *
   * Driven by `createActivities` to wire only the activities the provider
   * actually implements, so that consumers reading the type-level
   * capability set don't get out of sync with the runtime contract. The
   * stored value type stays at the wide `SandboxCapability` union so a
   * wide-cap provider remains structurally assignable to a narrow-cap
   * consumer interface (the type-level gating is enforced through the
   * conditional method shape, not through the set value type).
   */
  readonly supportedCapabilities: ReadonlySet<SandboxCapability>;

  create(options?: TOptions): Promise<SandboxCreateResult>;
  get(sandboxId: string): Promise<TSandbox>;
  destroy(sandboxId: string): Promise<void>;
}

/**
 * Provider-side sandbox lifecycle contract.
 *
 * Generic over an optional capability set (`TCaps`). Each capability gates
 * a specific method: when the cap is absent the corresponding key is
 * **removed** from the type entirely, so calling it produces a TypeScript
 * error at the call site instead of a runtime
 * {@link SandboxNotSupportedError}.
 *
 * The default `TCaps = SandboxCapability` resolves to the full union, so
 * existing usages that only pass `TOptions` / `TSandbox` continue to see
 * the full method surface (backwards compatible).
 *
 * Adapters that don't support a method should narrow `TCaps` accordingly:
 *
 * - In-memory / E2B: `SandboxCapability` (default — all caps present).
 * - Bedrock Code Interpreter / Daytona: `never` (only base ops).
 * - Bedrock AgentCore Runtime: `"pause" | "resume"`.
 */
export type SandboxProvider<
  TOptions extends SandboxCreateOptions = SandboxCreateOptions,
  TSandbox extends Sandbox = Sandbox,
  TCaps extends SandboxCapability = SandboxCapability,
> = SandboxProviderBase<TOptions, TSandbox> &
  SandboxProviderCapMethods<TOptions, TSandbox, TCaps>;

// ============================================================================
// SandboxOps — workflow-side activity interface (like ThreadOps)
// ============================================================================

/**
 * Capability-gated workflow-side methods. Mirrors the provider's gating:
 * keys whose capability is absent from `TCaps` are removed from the type.
 */
type SandboxOpsCapMethods<
  TOptions extends SandboxCreateOptions,
  TCaps extends SandboxCapability,
> = OmitNever<{
  pauseSandbox: "pause" extends TCaps
    ? (sandboxId: string) => Promise<void>
    : never;
  resumeSandbox: "resume" extends TCaps
    ? (sandboxId: string) => Promise<void>
    : never;
  snapshotSandbox: "snapshot" extends TCaps
    ? (sandboxId: string, options?: TOptions) => Promise<SandboxSnapshot>
    : never;
  deleteSandboxSnapshot: "snapshot" extends TCaps
    ? (snapshot: SandboxSnapshot) => Promise<void>
    : never;
  restoreSandbox: "restore" extends TCaps
    ? (snapshot: SandboxSnapshot, options?: TOptions) => Promise<string>
    : never;
  forkSandbox: "fork" extends TCaps
    ? (sandboxId: string, options?: TOptions) => Promise<string>
    : never;
}>;

/**
 * Always-present workflow-side lifecycle methods.
 */
interface SandboxOpsBase<
  TOptions extends SandboxCreateOptions,
  TCtx,
> {
  createSandbox(
    options?: TOptions,
    ctx?: TCtx
  ): Promise<{ sandboxId: string } | null>;
  destroySandbox(sandboxId: string): Promise<void>;
}

/**
 * Workflow-side counterpart to {@link SandboxProvider}. Exposed as a set of
 * Temporal activities and consumed by `createSession`'s `sandboxOps` field
 * and by `defineSubagent`'s `sandbox.proxy`.
 *
 * Generic over a capability set (`TCaps`) — same semantics as the provider:
 * keys whose capability is absent are removed from the type, so calling
 * them is a TypeScript error rather than a runtime throw. The default
 * `TCaps = SandboxCapability` keeps the full method surface for existing
 * consumers.
 */
export type SandboxOps<
  TOptions extends SandboxCreateOptions = SandboxCreateOptions,
  TCtx = unknown,
  TCaps extends SandboxCapability = SandboxCapability,
> = SandboxOpsBase<TOptions, TCtx> & SandboxOpsCapMethods<TOptions, TCaps>;

/**
 * Maps generic {@link SandboxOps} method names to adapter-prefixed names.
 *
 * Inherits the capability gating from {@link SandboxOps}: when `TCaps` omits
 * a capability the prefixed key carries the `never` type so call sites are
 * type-protected.
 *
 * @example
 * ```typescript
 * type InMemOps = PrefixedSandboxOps<"inMemory">;
 * // → { inMemoryCreateSandbox, inMemoryDestroySandbox, inMemorySnapshotSandbox, … }
 * ```
 */
export type PrefixedSandboxOps<
  TPrefix extends string,
  TOptions extends SandboxCreateOptions = SandboxCreateOptions,
  TCtx = unknown,
  TCaps extends SandboxCapability = SandboxCapability,
> = {
  [K in keyof SandboxOps<
    TOptions,
    TCtx,
    TCaps
  > as `${TPrefix}${Capitalize<K & string>}`]: SandboxOps<
    TOptions,
    TCtx,
    TCaps
  >[K];
};

// ============================================================================
// Errors
// ============================================================================

import { ApplicationFailure } from "@temporalio/common";

/**
 * Thrown by adapters that still surface an unsupported method at runtime.
 *
 * After the capability-generic refactor most adapters drop their
 * unsupported methods entirely so the type system rejects them at call
 * sites. This symbol is still exported so consumers running against older
 * adapter versions can keep their backwards-compatible error-handling
 * paths until they finish migrating.
 */
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
