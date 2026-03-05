import type { Sandbox } from "../../../lib/sandbox/types";
import type { RouterContext } from "../../../lib/tool-router/types";

// ============================================================================
// File Entry
// ============================================================================

/** JSON-serializable metadata for a single file in the virtual tree. */
export interface FileEntry {
  id: string;
  /** Virtual path inside the sandbox, e.g. "/src/index.ts" */
  path: string;
  size: number;
  /** ISO-8601 date string (JSON-safe) */
  mtime: string;
}

// ============================================================================
// Virtual File Tree
// ============================================================================

/**
 * Flat list of file entries.
 * Directories are inferred from file paths at runtime.
 */
export type VirtualFileTree = FileEntry[];

// ============================================================================
// Tree Mutations
// ============================================================================

export type TreeMutation =
  | { type: "add"; entry: FileEntry }
  | { type: "remove"; path: string }
  | { type: "update"; path: string; entry: Partial<FileEntry> };

// ============================================================================
// Resolver
// ============================================================================

/**
 * Consumer-provided bridge to the existing DB / S3 / CRUD layer.
 *
 * Generic over `TCtx` so every call receives workflow-level context
 * (e.g. `{ projectId: string }`) without the resolver holding state.
 *
 * Injected into the adapter at worker setup time.
 */
export interface FileResolver<TCtx = unknown> {
  /** Resolve a set of IDs into file metadata (no content loaded). */
  resolveEntries(ids: string[], ctx: TCtx): Promise<FileEntry[]>;
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
  ): Promise<FileEntry>;
  /** Delete a file by entry ID. */
  deleteFile(id: string, ctx: TCtx): Promise<void>;
}

// ============================================================================
// Workflow State Shape
// ============================================================================

/**
 * The portion of workflow `AgentState` that the virtual sandbox reads via
 * {@link queryParentWorkflowState}.
 */
export interface VirtualSandboxState<TCtx = unknown> {
  fileTree: FileEntry[];
  resolverContext: TCtx;
}

// ============================================================================
// Handler Context
// ============================================================================

/**
 * Extended router context injected by {@link withVirtualSandbox}.
 * Guarantees a live (ephemeral) sandbox built from the workflow file tree.
 */
export interface VirtualSandboxContext extends RouterContext {
  sandbox: Sandbox;
}
