import type { FileEntry } from "./types";

/**
 * Structural constraint: accepts any `AgentStateManager<T>` whose custom
 * state includes `fileTree: FileEntry<TMeta>[]`.
 */
export interface FileTreeAccessor<TMeta> {
  get(key: "fileTree"): FileEntry<TMeta>[];
}

/**
 * Check whether any file in the tree has a `metadata.mimeType` that matches
 * the given pattern.
 *
 * Patterns:
 * - Exact: `"application/pdf"`
 * - Wildcard type: `"image/*"`
 *
 * Useful for conditionally enabling tools:
 *
 * ```ts
 * { enabled: hasFileWithMimeType(stateManager, "image/*") }
 * { enabled: hasFileWithMimeType(stateManager, ["image/*", "application/pdf"]) }
 * ```
 */
export function hasFileWithMimeType<TMeta>(
  stateManager: FileTreeAccessor<TMeta>,
  pattern: string | string[],
): boolean {
  const tree = stateManager.get("fileTree");
  const matchers = (Array.isArray(pattern) ? pattern : [pattern]).map(buildMatcher);
  return tree.some((entry) => {
    const meta = entry.metadata as Record<string, unknown> | undefined;
    const mime = meta?.mimeType;
    return typeof mime === "string" && matchers.some((m) => m(mime));
  });
}

/**
 * Return all entries whose `metadata.mimeType` matches the given pattern.
 */
export function filesWithMimeType<TMeta>(
  stateManager: FileTreeAccessor<TMeta>,
  pattern: string,
): FileEntry<TMeta>[] {
  const tree = stateManager.get("fileTree");
  const match = buildMatcher(pattern);
  return tree.filter((entry) => {
    const meta = entry.metadata as Record<string, unknown> | undefined;
    const mime = meta?.mimeType;
    return typeof mime === "string" && match(mime);
  });
}

/**
 * Check whether the tree contains a directory whose name matches the given
 * pattern. Directories are inferred from file paths.
 *
 * Patterns:
 * - Exact: `"src"`
 * - Glob with `*` wildcard: `"test*"`, `"*.generated"`
 *
 * ```ts
 * { enabled: hasDirectory(stateManager, "test*") }
 * ```
 */
export function hasDirectory<TMeta>(
  stateManager: FileTreeAccessor<TMeta>,
  pattern: string,
): boolean {
  const tree = stateManager.get("fileTree");
  const match = buildGlobMatcher(pattern);
  return tree.some((entry) => {
    const segments = entry.path.split("/").filter(Boolean);
    return segments.slice(0, -1).some(match);
  });
}

// ---------------------------------------------------------------------------
// Internal matchers
// ---------------------------------------------------------------------------

function buildMatcher(pattern: string): (value: string) => boolean {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1);
    return (v) => v.startsWith(prefix);
  }
  return (v) => v === pattern;
}

function buildGlobMatcher(pattern: string): (value: string) => boolean {
  if (!pattern.includes("*")) return (v) => v === pattern;
  const re = new RegExp(
    "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
  );
  return (v) => re.test(v);
}
