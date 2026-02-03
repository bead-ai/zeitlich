import type { FileSystemProvider, FileNode } from "../../lib/filesystem/types";
import type { GlobToolSchemaType } from "./tool";

export interface GlobHandlerConfig {
  provider: FileSystemProvider;
  scopedNodes: FileNode[];
}

/**
 * Create a glob handler that searches within the scoped file tree.
 */
export function createGlobHandler(config: GlobHandlerConfig) {
  return async (
    args: GlobToolSchemaType
  ): Promise<{ content: string; result: { files: FileNode[] } }> => {
    const { pattern, root } = args;

    try {
      const matches = await config.provider.glob(pattern, root);

      if (matches.length === 0) {
        return {
          content: `No files found matching pattern: ${pattern}`,
          result: { files: [] },
        };
      }

      const paths = matches.map((node) => node.path);
      const fileList = paths.map((p) => `  ${p}`).join("\n");

      return {
        content: `Found ${matches.length} file(s) matching "${pattern}":\n${fileList}`,
        result: { files: matches },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: `Error searching for files: ${message}`,
        result: { files: [] },
      };
    }
  };
}
