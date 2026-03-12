import type { Sandbox, SandboxCreateOptions } from "../../../lib/sandbox/types";
import type { RouterContext } from "../../../lib/tool-router/types";
import type { VirtualSandboxFileSystem } from "./filesystem";

// ============================================================================
// File Entry
// ============================================================================

/** Allowed value types for file-entry metadata. */
export type FileEntryMetadata = Record<
  string,
  string | number | boolean | null
>;

/** JSON-serializable metadata for a single file in the virtual tree. */
export interface FileEntry<TMeta = FileEntryMetadata> {
  id: string;
  /** Virtual path inside the sandbox, e.g. "/src/index.ts" */
  path: string;
  size: number;
  /** ISO-8601 date string (JSON-safe) */
  mtime: string;
  metadata: TMeta;
}

// ============================================================================
// Virtual File Tree
// ============================================================================

/**
 * Flat list of file entries.
 * Directories are inferred from file paths at runtime.
 */
export type VirtualFileTree<TMeta = FileEntryMetadata> = FileEntry<TMeta>[];

// ============================================================================
// Tree Mutations
// ============================================================================

export type TreeMutation<TMeta = FileEntryMetadata> =
  | { type: "add"; entry: FileEntry<TMeta> }
  | { type: "remove"; path: string }
  | { type: "update"; path: string; entry: Partial<FileEntry<TMeta>> };

// ============================================================================
// Resolver
// ============================================================================

/**
 * Consumer-provided bridge to the existing DB / S3 / CRUD layer.
 *
 * Generic over `TCtx` so every call receives workflow-level context
 * (e.g. `{ projectId: string }`) without the resolver holding state.
 *
 * Generic over `TMeta` so resolved entries carry typed metadata.
 */
export interface FileResolver<TCtx = unknown, TMeta = FileEntryMetadata> {
  resolveEntries(ctx: TCtx): Promise<FileEntry<TMeta>[]>;
  readFile(id: string, ctx: TCtx): Promise<string>;
  readFileBuffer(id: string, ctx: TCtx): Promise<Uint8Array>;
  writeFile(id: string, content: string | Uint8Array, ctx: TCtx): Promise<void>;
  createFile(
    path: string,
    content: string | Uint8Array,
    ctx: TCtx
  ): Promise<FileEntry<TMeta>>;
  deleteFile(id: string, ctx: TCtx): Promise<void>;
}

// ============================================================================
// Create Options
// ============================================================================

/**
 * Options for {@link VirtualSandboxProvider.create}.
 * Extends base options with resolver context.
 */
export interface VirtualSandboxCreateOptions<
  TCtx,
> extends SandboxCreateOptions {
  resolverContext: TCtx;
  /** Base path for resolving relative filesystem paths (default "/"). */
  workspaceBase?: string;
}

// ============================================================================
// Workflow State Shape
// ============================================================================

/**
 * The portion of workflow `AgentState` that the virtual sandbox reads via
 * {@link queryParentWorkflowState}. Populated automatically by the session
 * from the provider's `stateUpdate` after `createSandbox`.
 */
export interface VirtualSandboxState<
  TCtx = unknown,
  TMeta = FileEntryMetadata,
> {
  sandboxId: string;
  fileTree: FileEntry<TMeta>[];
  resolverContext: TCtx;
  workspaceBase?: string;
}

// ============================================================================
// VirtualSandbox instance type
// ============================================================================

/**
 * A {@link Sandbox} whose filesystem is backed by a {@link VirtualSandboxFileSystem}.
 */
export type VirtualSandbox<
  TCtx = unknown,
  TMeta = FileEntryMetadata,
> = Sandbox & { fs: VirtualSandboxFileSystem<TCtx, TMeta> };

// ============================================================================
// Handler Context
// ============================================================================

/**
 * Extended router context injected by {@link withVirtualSandbox}.
 * Guarantees a live (ephemeral) sandbox built from the workflow file tree.
 */
export interface VirtualSandboxContext<
  TCtx = unknown,
  TMeta = FileEntryMetadata,
> extends RouterContext {
  sandbox: VirtualSandbox<TCtx, TMeta>;
}
