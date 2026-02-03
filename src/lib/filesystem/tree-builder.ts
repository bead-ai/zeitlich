import type { FileNode, FileTreeRenderOptions } from "./types";
import { minimatch } from "minimatch";

const DEFAULT_HEADER = "Available files and directories:";
const DEFAULT_DESCRIPTION =
  "You have access to the following files. Use the Read, Glob, and Grep tools to explore them.";

/**
 * Check if a path matches any of the exclude patterns
 */
function isExcluded(path: string, excludePatterns?: string[]): boolean {
  if (!excludePatterns || excludePatterns.length === 0) {
    return false;
  }
  return excludePatterns.some((pattern) => minimatch(path, pattern));
}

/**
 * Render a single node with proper indentation
 */
function renderNode(
  node: FileNode,
  options: FileTreeRenderOptions,
  depth: number,
  indent: string
): string[] {
  const lines: string[] = [];

  // Check depth limit
  if (options.maxDepth !== undefined && depth > options.maxDepth) {
    return lines;
  }

  // Check exclusion patterns
  if (isExcluded(node.path, options.excludePatterns)) {
    return lines;
  }

  // Get the filename from the path
  const parts = node.path.split("/");
  const name = parts[parts.length - 1] || node.path;

  // Build the line
  let line = indent;

  if (node.type === "directory") {
    line += `${name}/`;
  } else {
    line += name;
  }

  // Add MIME type if requested
  if (options.showMimeTypes && node.mimeType) {
    line += ` [${node.mimeType}]`;
  }

  // Add description if present and enabled
  if (options.showDescriptions !== false && node.description) {
    line += ` - ${node.description}`;
  }

  lines.push(line);

  // Render children for directories
  if (node.type === "directory" && node.children) {
    const childIndent = indent + "  ";
    for (const child of node.children) {
      lines.push(...renderNode(child, options, depth + 1, childIndent));
    }
  }

  return lines;
}

/**
 * Build a text representation of the file tree for injection into the agent's prompt.
 *
 * @param nodes Array of root-level file nodes
 * @param options Rendering options
 * @returns Formatted file tree string wrapped in <file_system> tags
 *
 * @example
 * ```typescript
 * const tree = buildFileTreePrompt([
 *   {
 *     path: "docs",
 *     type: "directory",
 *     children: [
 *       { path: "docs/readme.md", type: "file", description: "Project docs" }
 *     ]
 *   },
 *   { path: "src/index.ts", type: "file", description: "Entry point" }
 * ], { maxDepth: 2 });
 *
 * // Output:
 * // <file_system>
 * // Available files and directories:
 * //
 * // docs/
 * //   readme.md - Project docs
 * // src/index.ts - Entry point
 * // </file_system>
 * ```
 */
export function buildFileTreePrompt(
  nodes: FileNode[],
  options: FileTreeRenderOptions = {}
): string {
  const header = options.headerText ?? DEFAULT_HEADER;
  const description = options.descriptionText ?? DEFAULT_DESCRIPTION;
  const lines: string[] = [];

  for (const node of nodes) {
    lines.push(...renderNode(node, options, 0, ""));
  }

  if (lines.length === 0) {
    return `<file_system>\n${header}\n\n${description}\n\n(no files available)\n</file_system>`;
  }

  return `<file_system>\n${header}\n\n${lines.join("\n")}\n</file_system>`;
}

/**
 * Flatten a file tree into a list of all file paths.
 * Useful for scope validation.
 *
 * @param nodes Array of file nodes
 * @returns Array of all file paths (files only, not directories)
 */
export function flattenFileTree(nodes: FileNode[]): string[] {
  const paths: string[] = [];

  function traverse(node: FileNode): void {
    if (node.type === "file") {
      paths.push(node.path);
    }
    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  for (const node of nodes) {
    traverse(node);
  }

  return paths;
}

/**
 * Check if a path is within the scoped file tree.
 *
 * @param path Path to check
 * @param scopedNodes The file nodes that define the allowed scope
 * @returns true if the path is within scope
 */
export function isPathInScope(path: string, scopedNodes: FileNode[]): boolean {
  const allowedPaths = flattenFileTree(scopedNodes);
  return allowedPaths.includes(path);
}

/**
 * Find a node by path in the file tree.
 *
 * @param path Path to find
 * @param nodes Array of file nodes to search
 * @returns The matching node or undefined
 */
export function findNodeByPath(
  path: string,
  nodes: FileNode[]
): FileNode | undefined {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }
    if (node.children) {
      const found = findNodeByPath(path, node.children);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}
