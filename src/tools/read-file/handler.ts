import type { ActivityToolHandler } from "../../lib/tool-router";
import type { SandboxContext } from "../../lib/tool-router/with-sandbox";
import type { FileReadArgs } from "./tool";

interface ReadFileResult {
  path: string;
  content: string;
  totalLines?: number;
}

/**
 * Read-file tool handler — reads files from a {@link Sandbox} filesystem.
 *
 * Wrap with {@link withSandbox} at activity registration time to inject the
 * sandbox automatically.
 */
export const readFileHandler: ActivityToolHandler<
  FileReadArgs,
  ReadFileResult | null,
  SandboxContext
> = async (args, { sandbox }) => {
  const { fs } = sandbox;
  const { path, offset, limit } = args;

  try {
    const exists = await fs.exists(path);
    if (!exists) {
      return {
        toolResponse: `Error: File "${path}" does not exist.`,
        data: null,
      };
    }

    const raw = await fs.readFile(path);
    const lines = raw.split("\n");
    const totalLines = lines.length;

    if (offset !== undefined || limit !== undefined) {
      const start = Math.max(0, (offset ?? 1) - 1);
      const end = limit !== undefined ? start + limit : lines.length;
      const slice = lines.slice(start, end);
      const numbered = slice
        .map((line, i) => `${String(start + i + 1).padStart(6)}|${line}`)
        .join("\n");

      return {
        toolResponse: numbered,
        data: { path, content: numbered, totalLines },
      };
    }

    const numbered = lines
      .map((line, i) => `${String(i + 1).padStart(6)}|${line}`)
      .join("\n");

    return {
      toolResponse: numbered,
      data: { path, content: numbered, totalLines },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      toolResponse: `Error reading file "${path}": ${message}`,
      data: null,
    };
  }
};
