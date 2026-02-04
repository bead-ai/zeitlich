import type { FileSystemProvider, FileNode } from "../../lib/filesystem/types";
import { isPathInScope } from "../../lib/filesystem/tree-builder";
import type { WriteToolSchemaType } from "./tool";

/**
 * Tree update action for file tree mutations
 */
export interface TreeUpdate {
  action: "add";
  node: FileNode;
}

/**
 * Result of a write operation
 */
export interface WriteResult {
  path: string;
  success: boolean;
  created: boolean;
  bytesWritten: number;
  /** Tree update for new file creation - apply to workflow state */
  treeUpdate?: TreeUpdate;
}

/**
 * Write handler response
 */
export interface WriteHandlerResponse {
  content: string;
  result: WriteResult;
}

/**
 * Options for write handler
 */
export interface WriteHandlerOptions {
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

/**
 * Write handler that writes files within the scoped file tree.
 *
 * @param args - Tool arguments (file_path, content)
 * @param scopedNodes - The file tree defining the allowed scope
 * @param provider - FileSystemProvider for I/O operations
 * @param options - Additional options (readFiles, skipReadCheck)
 */
export async function writeHandler(
  args: WriteToolSchemaType,
  scopedNodes: FileNode[],
  provider: FileSystemProvider,
  options: WriteHandlerOptions
): Promise<WriteHandlerResponse> {
  const { file_path, content } = args;
  const { readFiles, skipReadCheck = false } = options;

  // Validate path is in scope
  if (!isPathInScope(file_path, scopedNodes)) {
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
  if (!skipReadCheck && !readFiles.has(file_path)) {
    // Check if file exists - new files don't need to be read first
    const exists = await provider.exists(file_path);
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
    const exists = await provider.exists(file_path);

    // Check if provider supports write
    if (!provider.write) {
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

    await provider.write(file_path, content);

    const bytesWritten = Buffer.byteLength(content, "utf-8");
    const action = exists ? "Updated" : "Created";
    const created = !exists;

    // Build result with optional tree update for new files
    const result: WriteResult = {
      path: file_path,
      success: true,
      created,
      bytesWritten,
    };

    // Include tree update for newly created files
    if (created) {
      result.treeUpdate = {
        action: "add",
        node: {
          path: file_path,
          type: "file",
        },
      };
    }

    return {
      content: `${action} file: ${file_path} (${bytesWritten} bytes)`,
      result,
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
}
