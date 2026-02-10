import type { ActivityToolHandler } from "../../lib/tool-router";
import type { GlobArgs } from "./tool";
import type { IFileSystem } from "just-bash";
import { Bash } from "just-bash";

/**
 * Result of a glob operation
 */
interface GlobResult {
  files: string[];
}

/**
 * Creates a glob handler that searches within the scoped file tree.
 *
 * @param fs - File system implementation for I/O operations
 * @returns An ActivityToolHandler for glob tool calls
 */
export function createGlobHandler(
  fs: IFileSystem
): ActivityToolHandler<GlobArgs, GlobResult> {
  return async (_args) => {
    // const { pattern, root } = args;
    const _bash = new Bash({ fs });

    return {
      toolResponse: "Hello, world!",
      data: { files: [] },
    };
  };
}
