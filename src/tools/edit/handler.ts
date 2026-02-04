import type { FileSystemProvider, FileNode } from "../../lib/filesystem/types";
import { isPathInScope } from "../../lib/filesystem/tree-builder";
import type { EditToolSchemaType } from "./tool";

/**
 * Result of an edit operation
 */
export interface EditResult {
  path: string;
  success: boolean;
  replacements: number;
}

/**
 * Edit handler response
 */
export interface EditHandlerResponse {
  content: string;
  result: EditResult;
}

/**
 * Options for edit handler
 */
export interface EditHandlerOptions {
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
 * Escape special regex characters in a string
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Edit handler that edits files within the scoped file tree.
 *
 * @param args - Tool arguments (file_path, old_string, new_string, replace_all)
 * @param scopedNodes - The file tree defining the allowed scope
 * @param provider - FileSystemProvider for I/O operations
 * @param options - Additional options (readFiles, skipReadCheck)
 */
export async function editHandler(
  args: EditToolSchemaType,
  scopedNodes: FileNode[],
  provider: FileSystemProvider,
  options: EditHandlerOptions
): Promise<EditHandlerResponse> {
  const { file_path, old_string, new_string, replace_all = false } = args;
  const { readFiles, skipReadCheck = false } = options;

  // Validate old_string !== new_string
  if (old_string === new_string) {
    return {
      content: `Error: old_string and new_string must be different.`,
      result: {
        path: file_path,
        success: false,
        replacements: 0,
      },
    };
  }

  // Validate path is in scope
  if (!isPathInScope(file_path, scopedNodes)) {
    return {
      content: `Error: Path "${file_path}" is not within the available file system scope.`,
      result: {
        path: file_path,
        success: false,
        replacements: 0,
      },
    };
  }

  // Check read-before-write requirement
  if (!skipReadCheck && !readFiles.has(file_path)) {
    return {
      content: `Error: You must read "${file_path}" before editing it. Use FileRead first.`,
      result: {
        path: file_path,
        success: false,
        replacements: 0,
      },
    };
  }

  try {
    // Check if file exists
    const exists = await provider.exists(file_path);
    if (!exists) {
      return {
        content: `Error: File "${file_path}" does not exist.`,
        result: {
          path: file_path,
          success: false,
          replacements: 0,
        },
      };
    }

    // Check if provider supports write
    if (!provider.write) {
      return {
        content: `Error: The file system provider does not support write operations.`,
        result: {
          path: file_path,
          success: false,
          replacements: 0,
        },
      };
    }

    // Read current content
    const fileContent = await provider.read(file_path);
    if (fileContent.type !== "text") {
      return {
        content: `Error: FileEdit only works with text files. "${file_path}" is ${fileContent.type}.`,
        result: {
          path: file_path,
          success: false,
          replacements: 0,
        },
      };
    }

    const content = fileContent.content;

    // Check if old_string exists in the file
    if (!content.includes(old_string)) {
      return {
        content: `Error: Could not find the specified text in "${file_path}". Make sure old_string matches exactly (whitespace-sensitive).`,
        result: {
          path: file_path,
          success: false,
          replacements: 0,
        },
      };
    }

    // Count occurrences
    const escapedOldString = escapeRegExp(old_string);
    const globalRegex = new RegExp(escapedOldString, "g");
    const occurrences = (content.match(globalRegex) || []).length;

    // Check uniqueness if not replace_all
    if (!replace_all && occurrences > 1) {
      return {
        content: `Error: old_string appears ${occurrences} times in "${file_path}". Either provide more context to make it unique, or use replace_all: true.`,
        result: {
          path: file_path,
          success: false,
          replacements: 0,
        },
      };
    }

    // Perform replacement
    let newContent: string;
    let replacements: number;

    if (replace_all) {
      newContent = content.split(old_string).join(new_string);
      replacements = occurrences;
    } else {
      // Replace only the first occurrence
      const index = content.indexOf(old_string);
      newContent =
        content.slice(0, index) +
        new_string +
        content.slice(index + old_string.length);
      replacements = 1;
    }

    // Write the modified content
    await provider.write(file_path, newContent);

    const summary = replace_all
      ? `Replaced ${replacements} occurrence(s)`
      : `Replaced 1 occurrence`;

    return {
      content: `${summary} in ${file_path}`,
      result: {
        path: file_path,
        success: true,
        replacements,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      content: `Error editing file "${file_path}": ${message}`,
      result: {
        path: file_path,
        success: false,
        replacements: 0,
      },
    };
  }
}
