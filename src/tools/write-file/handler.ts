import type { ActivityToolHandler } from "../../lib/tool-router";
import type { FileWriteArgs } from "./tool";
import type { SandboxManager } from "../../lib/sandbox/manager";

interface WriteFileResult {
  path: string;
  success: boolean;
}

/**
 * Creates a write-file handler that writes files via a {@link Sandbox}.
 *
 * @param manager - The {@link SandboxManager} instance that holds live sandboxes
 * @returns An ActivityToolHandler for write-file tool calls
 */
export function createWriteFileHandler(
  manager: SandboxManager,
): ActivityToolHandler<FileWriteArgs, WriteFileResult> {
  return async (args, context) => {
    const { sandboxId } = context;

    if (!sandboxId) {
      return {
        toolResponse:
          "Error: No sandbox configured for this agent. The FileWrite tool requires a sandbox.",
        data: { path: args.file_path, success: false },
      };
    }

    const { fs } = manager.getSandbox(sandboxId);
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
