import type { ActivityToolHandler } from "../../lib/tool-router";
import type { SandboxContext } from "../../lib/tool-router/with-sandbox";
import type { FileEditArgs } from "./tool";

interface EditResult {
  path: string;
  success: boolean;
  replacements: number;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Edit tool handler — performs string replacements in sandbox files.
 *
 * Wrap with {@link withSandbox} at activity registration time to inject the
 * sandbox automatically.
 */
export const editHandler: ActivityToolHandler<
  FileEditArgs,
  EditResult,
  SandboxContext
> = async (args, { sandbox }) => {
  const { fs } = sandbox;
  const { file_path, old_string, new_string, replace_all = false } = args;

  if (old_string === new_string) {
    return {
      toolResponse: `Error: old_string and new_string must be different.`,
      data: { path: file_path, success: false, replacements: 0 },
    };
  }

  try {
    const exists = await fs.exists(file_path);
    if (!exists) {
      return {
        toolResponse: `Error: File "${file_path}" does not exist.`,
        data: { path: file_path, success: false, replacements: 0 },
      };
    }

    const content = await fs.readFile(file_path);

    if (!content.includes(old_string)) {
      return {
        toolResponse: `Error: Could not find the specified text in "${file_path}". Make sure old_string matches exactly (whitespace-sensitive).`,
        data: { path: file_path, success: false, replacements: 0 },
      };
    }

    const escapedOldString = escapeRegExp(old_string);
    const globalRegex = new RegExp(escapedOldString, "g");
    const occurrences = (content.match(globalRegex) || []).length;

    if (!replace_all && occurrences > 1) {
      return {
        toolResponse: `Error: old_string appears ${occurrences} times in "${file_path}". Either provide more context to make it unique, or use replace_all: true.`,
        data: { path: file_path, success: false, replacements: 0 },
      };
    }

    let newContent: string;
    let replacements: number;

    if (replace_all) {
      newContent = content.split(old_string).join(new_string);
      replacements = occurrences;
    } else {
      const index = content.indexOf(old_string);
      newContent =
        content.slice(0, index) +
        new_string +
        content.slice(index + old_string.length);
      replacements = 1;
    }

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
