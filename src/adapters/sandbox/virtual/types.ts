import type { Sandbox, SandboxCreateOptions } from "../../../lib/sandbox/types";
import type { RouterContext } from "../../../lib/tool-router/types";
import type { VirtualSandboxFileSystem } from "./filesystem";

// ============================================================================
// File Entry
// ============================================================================

/** Allowed value types for file-entry metadata. */
export type FileEntryMetadata = Record<string, string | number | boolean | null>;

interface FileEntryBase {
  id: string;
  /** Virtual path inside the sandbox, e.g. "/src/index.ts" */
  path: string;
  size: number;
  /** ISO-8601 date string (JSON-safe) */
  mtime: string;
}

/**
 * JSON-serializable metadata for a single file in the virtual tree.
 *
 * When `TMeta` is narrowed to a specific shape, `metadata` becomes required.
 * With the default (`FileEntryMetadata`), it stays optional.
 */
export type FileEntry<
  TMeta extends FileEntryMetadata = FileEntryMetadata,
> = FileEntryBase &
  (FileEntryMetadata extends TMeta
    ? { metadata?: TMeta }
    : { metadata: TMeta });

// ============================================================================
// Virtual File Tree
// ============================================================================

/**
 * Flat list of file entries.
 * Directories are inferred from file paths at runtime.
 */
export type VirtualFileTree<
  TMeta extends FileEntryMetadata = FileEntryMetadata,
> = FileEntry<TMeta>[];

// ============================================================================
// Tree Mutations
// ============================================================================

export type TreeMutation<
  TMeta extends FileEntryMetadata = FileEntryMetadata,
> =
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
 *
 * Injected into the adapter at worker setup time.
 */
export interface FileResolver<
  TCtx = unknown,
  TMeta extends FileEntryMetadata = FileEntryMetadata,
> {
  /** Resolve a set of IDs into file metadata (no content loaded). */
  resolveEntries(ids: string[], ctx: TCtx): Promise<FileEntry<TMeta>[]>;
  /** Lazy-load file content by entry ID. */
  readFile(id: string, ctx: TCtx): Promise<string>;
  /** Lazy-load file content as binary by entry ID. */
  readFileBuffer(id: string, ctx: TCtx): Promise<Uint8Array>;
  /** Write content back for an existing entry. */
  writeFile(
    id: string,
    content: string | Uint8Array,
    ctx: TCtx,
  ): Promise<void>;
  /** Create a new file and return its entry (with generated ID). */
  createFile(
    path: string,
    content: string | Uint8Array,
    ctx: TCtx,
  ): Promise<FileEntry<TMeta>>;
  /** Delete a file by entry ID. */
  deleteFile(id: string, ctx: TCtx): Promise<void>;
}

// ============================================================================
// Create Options
// ============================================================================

/**
 * Options for {@link VirtualSandboxProvider.create}.
 * Extends base options with file IDs to resolve and resolver context.
 */
export interface VirtualSandboxCreateOptions<TCtx>
  extends SandboxCreateOptions {
  fileIds: string[];
  resolverContext: TCtx;
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
  TMeta extends FileEntryMetadata = FileEntryMetadata,
> {
  sandboxId: string;
  fileTree: FileEntry<TMeta>[];
  resolverContext: TCtx;
}

// ============================================================================
// Handler Context
// ============================================================================

/**
 * Extended router context injected by {@link withVirtualSandbox}.
 * Guarantees a live (ephemeral) sandbox built from the workflow file tree.
 */
export interface VirtualSandboxContext<
  TCtx = unknown,
  TMeta extends FileEntryMetadata = FileEntryMetadata,
> extends RouterContext {
  sandbox: Sandbox & { fs: VirtualSandboxFileSystem<TCtx, TMeta> };
}
