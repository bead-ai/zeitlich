// ============================================================================
// Generic managed-resource core
//
// Resource-agnostic primitives shared by every "managed remote resource with
// a lifecycle" — currently sandboxes (`src/lib/sandbox`) and browser sessions
// (`src/lib/browser`). The control-plane (capability vocabulary, snapshot
// shape, create options, capability-gating helpers) lives here; each resource
// family layers its own data-plane (a `Sandbox` has `fs` + `exec`; a
// `BrowserSession` has `getConnection`) and its own provider/ops method names
// on top.
// ============================================================================

import { ApplicationFailure } from "@temporalio/common";

/**
 * Minimal contract every managed resource handle satisfies: a stable id and
 * a teardown method. Concrete resources (`Sandbox`, `BrowserSession`) extend
 * this with their data-plane surface.
 */
export interface ManagedResource {
  readonly id: string;
  destroy(): Promise<void>;
}

// ============================================================================
// Network & lifecycle
// ============================================================================

export interface ResourceNetworkConfig {
  allowOut?: string[];
  denyOut?: string[];
  allowPublicTraffic?: boolean;
}

export interface ResourceLifecycleConfig {
  onTimeout: "kill" | "pause";
  autoResume?: boolean;
}

// ============================================================================
// Capabilities
// ============================================================================

/**
 * Type-level capability vocabulary for resource providers and ops. Adapters
 * declare the subset they actually support; the conditional types on each
 * contract gate the corresponding methods so unsupported calls become a
 * compile-time error rather than a runtime {@link ResourceNotSupportedError}.
 *
 * `pause` and `resume` are split because some adapters might support one
 * direction without the other. The `snapshot` cap covers both `snapshot()`
 * and `deleteSnapshot()` since they always travel together in practice.
 */
export type ResourceCapability =
  | "pause"
  | "resume"
  | "snapshot"
  | "restore"
  | "fork";

// ============================================================================
// Snapshots
// ============================================================================

/**
 * Provider-agnostic snapshot envelope. Resource families that capture
 * snapshots may extend or re-shape this (e.g. `SandboxSnapshot` renames
 * `resourceId` to `sandboxId` for backwards-compatibility).
 */
export interface ResourceSnapshot {
  resourceId: string;
  providerId: string;
  /** Provider-specific serialised state */
  data: unknown;
  createdAt: string;
}

// ============================================================================
// Create options
// ============================================================================

/**
 * Base options accepted when creating a managed resource. Resource families
 * extend this with their own fields (e.g. `SandboxCreateOptions` adds
 * `initialFiles`; `BrowserCreateOptions` adds `browserIdentifier`).
 */
export interface ResourceCreateOptions {
  /** Preferred resource ID (provider may ignore) */
  id?: string;
  /** Environment variables available inside the resource */
  env?: Record<string, string>;
  /** Key-value metadata surfaced via provider list/query APIs */
  metadata?: Record<string, string>;
  /** Idle timeout in milliseconds */
  timeoutMs?: number;
  /** Enable or disable outbound internet access */
  allowInternetAccess?: boolean;
  /** Outbound network allow/deny rules */
  network?: ResourceNetworkConfig;
  /** Timeout behaviour */
  lifecycle?: ResourceLifecycleConfig;
}

// ============================================================================
// Type helpers
// ============================================================================

/**
 * Drop keys whose value is `never` from an object type.
 *
 * Used by the capability-gated contracts so that an absent capability removes
 * the corresponding key entirely, instead of leaving a required field with
 * type `never` (which would make implementations impossible).
 */
export type OmitNever<T> = {
  [K in keyof T as [T[K]] extends [never] ? never : K]: T[K];
};

// ============================================================================
// Errors
// ============================================================================

/**
 * Thrown by adapters that surface an unsupported lifecycle method at runtime.
 */
export class ResourceNotSupportedError extends ApplicationFailure {
  constructor(operation: string) {
    super(
      `Resource does not support: ${operation}`,
      "ResourceNotSupportedError",
      true
    );
  }
}

export class ResourceNotFoundError extends ApplicationFailure {
  constructor(resourceId: string) {
    super(`Resource not found: ${resourceId}`, "ResourceNotFoundError", true);
  }
}
