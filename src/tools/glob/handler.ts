import type { FileSystemProvider, FileNode } from "../../lib/filesystem/types";
import type { GlobToolSchemaType } from "./tool";

/**
 * Result of a glob operation
 */
export interface GlobResult {
  files: FileNode[];
}

/**
 * Glob handler response
 */
export interface GlobHandlerResponse {
  content: string;
  result: GlobResult;
}

/**
 * Glob handler that searches within the scoped file tree.
 *
 * @param args - Tool arguments (pattern, root)
 * @param provider - FileSystemProvider for I/O operations
 */
export async function globHandler(
  args: GlobToolSchemaType,
  provider: FileSystemProvider
): Promise<GlobHandlerResponse> {
  const { pattern, root } = args;

  try {
    const matches = await provider.glob(pattern, root);

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
}
