// Types
export type {
  FileNode,
  FileTreeRenderOptions,
  FileSystemProvider,
  FileSystemToolsConfig,
  GrepOptions,
  GrepMatch,
  FileContent,
} from "./types";

export { fileContentToMessageContent } from "./types";

// Tree builder utilities
export {
  buildFileTreePrompt,
  flattenFileTree,
  isPathInScope,
  findNodeByPath,
} from "./tree-builder";

// Providers
export {
  BaseFileSystemProvider,
  InMemoryFileSystemProvider,
  CompositeFileSystemProvider,
} from "./providers/base";
export type { FileResolver, BackendConfig } from "./providers/base";
