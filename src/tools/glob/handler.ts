import type { IFileSystem } from "just-bash";
import { Bash } from "just-bash";
import type { GlobToolSchemaType } from "./tool";

/**
 * Result of a glob operation
 */
export interface GlobResult {
  files: string[];
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
  _args: GlobToolSchemaType,
  fs: IFileSystem
): Promise<GlobHandlerResponse> {
  // const { pattern, root } = args;
  const _bash = new Bash({ fs });

  return Promise.resolve({
    content: "Hello, world!",
    result: { files: [] },
  });

  // try {
  //   const matches = await bash.exec(`glob ${root} -name "${pattern}"`);

  //   if (matches.length === 0) {
  //     return {
  //       content: `No files found matching pattern: ${pattern}`,
  //       result: { files: [] },
  //     };
  //   }

  //   const paths = matches.map((node) => node.path);
  //   const fileList = paths.map((p) => `  ${p}`).join("\n");

  //   return {
  //     content: `Found ${matches.length} file(s) matching "${pattern}":\n${fileList}`,
  //     result: { files: matches },
  //   };
  // } catch (error) {
  //   const message = error instanceof Error ? error.message : "Unknown error";
  //   return {
  //     content: `Error searching for files: ${message}`,
  //     result: { files: [] },
  //   };
  // }
}
