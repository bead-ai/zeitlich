export { VirtualFileSystem } from "./filesystem";
export { withVirtualFs } from "./with-virtual-fs";
export { createVirtualFsActivities } from "./manager";
export { hasFileWithMimeType, filesWithMimeType, hasDirectory } from "./queries";
export { applyVirtualTreeMutations } from "./mutations";
export { formatVirtualFileTree } from "./tree";
export type { FileTreeAccessor } from "./queries";
export type {
  FileEntry,
  FileEntryMetadata,
  FileResolver,
  VirtualFileTree,
  VirtualFsOps,
  PrefixedVirtualFsOps,
  VirtualFsState,
  VirtualFsContext,
  TreeMutation,
} from "./types";
