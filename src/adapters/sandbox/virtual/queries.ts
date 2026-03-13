import type { FileEntry, VirtualFileTree } from "./types";

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
 * { enabled: hasFileWithMimeType(tree, "image/*") }
 * ```
 */
export function hasFileWithMimeType(
  tree: VirtualFileTree,
  pattern: string,
): boolean {
  const match = buildMatcher(pattern);
  return tree.some((entry) => {
    const mime = entry.metadata?.mimeType;
    return typeof mime === "string" && match(mime);
  });
}

/**
 * Return all entries whose `metadata.mimeType` matches the given pattern.
 */
export function filesWithMimeType<TMeta>(
  tree: FileEntry<TMeta>[],
  pattern: string,
): FileEntry<TMeta>[] {
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
 * { enabled: hasDirectory(tree, "test*") }
 * ```
 */
export function hasDirectory(
  tree: VirtualFileTree,
  pattern: string,
): boolean {
  const match = buildGlobMatcher(pattern);
  return tree.some((entry) => {
    const segments = entry.path.split("/").filter(Boolean);
    // Every segment except the last is a directory name
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
