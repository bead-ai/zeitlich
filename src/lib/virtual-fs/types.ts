import type { RouterContext } from "../tool-router/types";
import type { VirtualFileSystem } from "./filesystem";

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
  /** Virtual path, e.g. "/src/index.ts" */
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
  readFile(id: string, ctx: TCtx, metadata: TMeta): Promise<string>;
  readFileBuffer(id: string, ctx: TCtx, metadata: TMeta): Promise<Uint8Array>;
  writeFile(
    id: string,
    content: string | Uint8Array,
    ctx: TCtx,
    metadata: TMeta
  ): Promise<void>;
  createFile(
    path: string,
    content: string | Uint8Array,
    ctx: TCtx
  ): Promise<FileEntry<TMeta>>;
  deleteFile(id: string, ctx: TCtx, metadata: TMeta): Promise<void>;
}

// ============================================================================
// VirtualFsOps — workflow-side activity interface
// ============================================================================

/**
 * Workflow-side operations for the virtual filesystem.
 *
 * Unlike {@link SandboxOps}, this only exposes what is actually needed:
 * resolving the initial file tree from the consumer's data layer.
 */
export interface VirtualFsOps<TCtx = unknown, TMeta = FileEntryMetadata> {
  resolveFileTree(ctx: TCtx): Promise<{
    fileTree: FileEntry<TMeta>[];
  }>;
}

/**
 * Maps generic {@link VirtualFsOps} method names to scope-prefixed names.
 *
 * @example
 * ```typescript
 * type Ops = PrefixedVirtualFsOps<"codingAgent">;
 * // → { codingAgentResolveFileTree: ... }
 * ```
 */
export type PrefixedVirtualFsOps<
  TPrefix extends string,
  TCtx = unknown,
  TMeta = FileEntryMetadata,
> = {
  [K in keyof VirtualFsOps<
    TCtx,
    TMeta
  > as `${TPrefix}${Capitalize<K & string>}`]: VirtualFsOps<TCtx, TMeta>[K];
};

// ============================================================================
// Workflow State Shape
// ============================================================================

/**
 * The portion of workflow `AgentState` that the virtual filesystem reads via
 * {@link queryParentWorkflowState}. Populated automatically by the session
 * when `virtualFs` config is provided.
 */
export interface VirtualFsState<TCtx = unknown, TMeta = FileEntryMetadata> {
  fileTree: FileEntry<TMeta>[];
  ctx: TCtx;
  workspaceBase?: string;
}

// ============================================================================
// Handler Context
// ============================================================================

/**
 * Extended router context injected by {@link withVirtualFs}.
 * Guarantees a live (ephemeral) virtual filesystem built from the workflow
 * file tree.
 */
export interface VirtualFsContext<
  TCtx = unknown,
  TMeta = FileEntryMetadata,
> extends RouterContext {
  virtualFs: VirtualFileSystem<TCtx, TMeta>;
}
