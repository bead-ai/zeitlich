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

function buildMatcher(pattern: string): (mime: string) => boolean {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1);
    return (mime) => mime.startsWith(prefix);
  }
  return (mime) => mime === pattern;
}
