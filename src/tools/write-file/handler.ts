import type { ActivityToolHandler } from "../../lib/tool-router";
import type { SandboxContext } from "../../lib/tool-router/with-sandbox";
import type { FileWriteArgs } from "./tool";

interface WriteFileResult {
  path: string;
  success: boolean;
}

/**
 * Write-file tool handler — writes files to a {@link Sandbox} filesystem.
 *
 * Wrap with {@link withSandbox} at activity registration time to inject the
 * sandbox automatically.
 */
export const writeFileHandler: ActivityToolHandler<
  FileWriteArgs,
  WriteFileResult,
  SandboxContext
> = async (args, { sandbox }) => {
  const { fs } = sandbox;
  const { file_path, content } = args;

  try {
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
