import type { FileSystemProvider, FileNode } from "../../lib/filesystem/types";
import { isPathInScope } from "../../lib/filesystem/tree-builder";
import type { WriteToolSchemaType } from "./tool";

export interface WriteHandlerConfig {
  provider: FileSystemProvider;
  scopedNodes: FileNode[];
  /**
   * Set of file paths that have been read in this session.
   * Required for enforcing read-before-write policy.
   */
  readFiles: Set<string>;
  /**
   * If true, skip the read-before-write check (not recommended)
   */
  skipReadCheck?: boolean;
}

export interface WriteResult {
  path: string;
  success: boolean;
  created: boolean;
  bytesWritten: number;
}

/**
 * Create a write handler that writes files within the scoped file tree.
 */
export function createWriteHandler(config: WriteHandlerConfig) {
  return async (
    args: WriteToolSchemaType
  ): Promise<{ content: string; result: WriteResult }> => {
    const { file_path, content } = args;

    // Validate path is in scope
    if (!isPathInScope(file_path, config.scopedNodes)) {
      return {
        content: `Error: Path "${file_path}" is not within the available file system scope.`,
        result: {
          path: file_path,
          success: false,
          created: false,
          bytesWritten: 0,
        },
      };
    }

    // Check read-before-write requirement
    if (!config.skipReadCheck && !config.readFiles.has(file_path)) {
      // Check if file exists - new files don't need to be read first
      const exists = await config.provider.exists(file_path);
      if (exists) {
        return {
          content: `Error: You must read "${file_path}" before writing to it. Use FileRead first.`,
          result: {
            path: file_path,
            success: false,
            created: false,
            bytesWritten: 0,
          },
        };
      }
    }

    try {
      const exists = await config.provider.exists(file_path);

      // Check if provider supports write
      if (!config.provider.write) {
        return {
          content: `Error: The file system provider does not support write operations.`,
          result: {
            path: file_path,
            success: false,
            created: false,
            bytesWritten: 0,
          },
        };
      }

      await config.provider.write(file_path, content);

      const bytesWritten = Buffer.byteLength(content, "utf-8");
      const action = exists ? "Updated" : "Created";

      return {
        content: `${action} file: ${file_path} (${bytesWritten} bytes)`,
        result: {
          path: file_path,
          success: true,
          created: !exists,
          bytesWritten,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: `Error writing file "${file_path}": ${message}`,
        result: {
          path: file_path,
          success: false,
          created: false,
          bytesWritten: 0,
        },
      };
    }
  };
}
