import type { ActivityToolHandler } from "../../lib/tool-router";
import type { FileEditArgs } from "./tool";
import type { IFileSystem } from "just-bash";

/**
 * Result of an edit operation
 */
interface EditResult {
  path: string;
  success: boolean;
  replacements: number;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Creates an edit handler that edits files within the scoped file tree.
 *
 * @param fs - File system implementation for I/O operations
 * @returns An ActivityToolHandler for edit tool calls
 */
export function createEditHandler(
  fs: IFileSystem
): ActivityToolHandler<FileEditArgs, EditResult> {
  return async (args) => {
    const { file_path, old_string, new_string, replace_all = false } = args;

    // Validate old_string !== new_string
    if (old_string === new_string) {
      return {
        toolResponse: `Error: old_string and new_string must be different.`,
        data: { path: file_path, success: false, replacements: 0 },
      };
    }

    try {
      // Check if file exists
      const exists = await fs.exists(file_path);
      if (!exists) {
        return {
          toolResponse: `Error: File "${file_path}" does not exist.`,
          data: { path: file_path, success: false, replacements: 0 },
        };
      }

      // Read current content
      const content = await fs.readFile(file_path);

      // Check if old_string exists in the file
      if (!content.includes(old_string)) {
        return {
          toolResponse: `Error: Could not find the specified text in "${file_path}". Make sure old_string matches exactly (whitespace-sensitive).`,
          data: { path: file_path, success: false, replacements: 0 },
        };
      }

      // Count occurrences
      const escapedOldString = escapeRegExp(old_string);
      const globalRegex = new RegExp(escapedOldString, "g");
      const occurrences = (content.match(globalRegex) || []).length;

      // Check uniqueness if not replace_all
      if (!replace_all && occurrences > 1) {
        return {
          toolResponse: `Error: old_string appears ${occurrences} times in "${file_path}". Either provide more context to make it unique, or use replace_all: true.`,
          data: { path: file_path, success: false, replacements: 0 },
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
      await fs.writeFile(file_path, newContent);

      const summary = replace_all
        ? `Replaced ${replacements} occurrence(s)`
        : `Replaced 1 occurrence`;

      return {
        toolResponse: `${summary} in ${file_path}`,
        data: { path: file_path, success: true, replacements },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        toolResponse: `Error editing file "${file_path}": ${message}`,
        data: { path: file_path, success: false, replacements: 0 },
      };
    }
  };
}
