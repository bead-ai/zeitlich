import type { FileEntry } from "./types";

interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
  isFile: boolean;
}

const buildTree = <T>(entries: FileEntry<T>[]): TreeNode => {
  const root: TreeNode = { name: "/", children: new Map(), isFile: false };

  for (const entry of entries) {
    const parts = entry.path.split("/").filter(Boolean);
    let current = root;
    for (const part of parts) {
      let child = current.children.get(part);
      if (!child) {
        child = { name: part, children: new Map(), isFile: false };
        current.children.set(part, child);
      }
      current = child;
    }
    current.isFile = current.children.size === 0;
  }

  return root;
};

const printNode = (node: TreeNode, tab: string, sort: boolean): string => {
  const entries = [...node.children.values()];
  if (sort) {
    entries.sort((a, b) => {
      if (!a.isFile && !b.isFile) return a.name.localeCompare(b.name);
      if (!a.isFile) return -1;
      if (!b.isFile) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  let str = "";
  for (const [i, entry] of entries.entries()) {
    const isLast = i === entries.length - 1;
    const branch = isLast ? "└─" : "├─";
    const childTab = tab + (isLast ? "   " : "│  ");

    if (entry.isFile) {
      str += "\n" + tab + branch + " " + entry.name;
    } else {
      const subtree = printNode(entry, childTab, sort);
      str += "\n" + tab + branch + " " + entry.name + "/" + subtree;
    }
  }
  return str;
};

/**
 * Generates a formatted file tree string from a flat {@link FileEntry} list.
 * Directories are inferred from file paths — no filesystem access needed.
 *
 * @param entries - Flat list of file entries
 * @param opts - Optional configuration
 * @param opts.sort - Sort entries alphabetically with directories first (defaults to true)
 * @returns Formatted file tree string
 *
 * @example
 * ```typescript
 * const tree = formatVirtualFileTree(state.fileTree);
 * // /
 * // ├─ src/
 * // │  ├─ index.ts
 * // │  └─ utils.ts
 * // └─ package.json
 * ```
 */
export function formatVirtualFileTree<T>(
  entries: FileEntry<T>[],
  opts: { sort?: boolean } = {}
): string {
  const sort = opts.sort ?? true;
  const root = buildTree(entries);
  return "/" + printNode(root, "", sort);
}
