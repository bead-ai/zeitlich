import type { FileEntryMetadata, TreeMutation, VirtualFileTree } from "./types";

/**
 * Apply a list of {@link TreeMutation}s to the `fileTree` stored in a state
 * manager instance, updating it in place and returning the new tree.
 *
 * The `stateManager` parameter is structurally typed so any
 * {@link AgentStateManager} whose custom state includes
 * `fileTree: VirtualFileTree<TMeta>` will satisfy it.
 */
export function applyVirtualTreeMutations<TMeta = FileEntryMetadata>(
  stateManager: {
    get(key: "fileTree"): VirtualFileTree<TMeta>;
    set(key: "fileTree", value: VirtualFileTree<TMeta>): void;
  },
  mutations: TreeMutation<TMeta>[],
): VirtualFileTree<TMeta> {
  let tree = [...stateManager.get("fileTree")];

  for (const m of mutations) {
    switch (m.type) {
      case "add":
        tree.push(m.entry);
        break;
      case "remove":
        tree = tree.filter((e) => e.path !== m.path);
        break;
      case "update":
        tree = tree.map((e) => (e.path === m.path ? { ...e, ...m.entry } : e));
        break;
    }
  }

  stateManager.set("fileTree", tree);
  return tree;
}
