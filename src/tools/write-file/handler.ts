import type { ActivityToolHandler } from "../../lib/tool-router";
import type { FileWriteArgs } from "./tool";
import type { Sandbox } from "../../lib/sandbox/types";

interface WriteFileResult {
  path: string;
  success: boolean;
}

type GetSandbox = (id: string) => Sandbox;

/**
 * Creates a write-file handler that writes files via a {@link Sandbox}.
 *
 * @param getSandbox - Looks up the sandbox for the given ID
 * @returns An ActivityToolHandler for write-file tool calls
 */
export function createWriteFileHandler(
  getSandbox: GetSandbox,
): ActivityToolHandler<FileWriteArgs, WriteFileResult> {
  return async (args, context) => {
    const sandboxId = (context as Record<string, unknown>)?.sandboxId as
      | string
      | undefined;

    if (!sandboxId) {
      return {
        toolResponse:
          "Error: No sandbox configured for this agent. The FileWrite tool requires a sandbox.",
        data: { path: args.file_path, success: false },
      };
    }

    const { fs } = getSandbox(sandboxId);
    const { file_path, content } = args;

    try {
      // Ensure parent directories exist
      const lastSlash = file_path.lastIndexOf("/");
      if (lastSlash > 0) {
        const dir = file_path.slice(0, lastSlash);
        const dirExists = await fs.exists(dir);
        if (!dirExists) {
          await fs.mkdir(dir, { recursive: true });
        }
      }

      await fs.writeFile(file_path, content);

      return {
        toolResponse: `Successfully wrote to ${file_path}`,
        data: { path: file_path, success: true },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        toolResponse: `Error writing file "${file_path}": ${message}`,
        data: { path: file_path, success: false },
      };
    }
  };
}
