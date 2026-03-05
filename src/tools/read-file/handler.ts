import type { ActivityToolHandler } from "../../lib/tool-router";
import type { FileReadArgs } from "./tool";
import type { SandboxManager } from "../../lib/sandbox/manager";

interface ReadFileResult {
  path: string;
  content: string;
  totalLines?: number;
}

/**
 * Creates a read-file handler that reads files via a {@link Sandbox}.
 *
 * @param manager - The {@link SandboxManager} instance that holds live sandboxes
 * @returns An ActivityToolHandler for read-file tool calls
 */
export function createReadFileHandler(
  manager: SandboxManager,
): ActivityToolHandler<FileReadArgs, ReadFileResult | null> {
  return async (args, context) => {
    const { sandboxId } = context;

    if (!sandboxId) {
      return {
        toolResponse:
          "Error: No sandbox configured for this agent. The FileRead tool requires a sandbox.",
        data: null,
      };
    }

    const { fs } = manager.getSandbox(sandboxId);
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
}
