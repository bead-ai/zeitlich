import type { ActivityToolHandler } from "../../lib/tool-router";
import type { GlobArgs } from "./tool";
import type { Sandbox } from "../../lib/sandbox/types";
import type { SandboxManager } from "../../lib/sandbox/manager";

interface GlobResult {
  files: string[];
}

/**
 * Simple glob-style matcher (supports `*` and `**`).
 */
function matchGlob(pattern: string, path: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${regex}$`).test(path);
}

async function walk(
  fs: Sandbox["fs"],
  dir: string,
): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdirWithFileTypes(dir);
  for (const entry of entries) {
    const full = dir === "/" ? `/${entry.name}` : `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      results.push(...(await walk(fs, full)));
    } else {
      results.push(full);
    }
  }
  return results;
}

/**
 * Creates a glob handler that searches within a {@link Sandbox} filesystem.
 *
 * @param manager - The {@link SandboxManager} instance that holds live sandboxes
 * @returns An ActivityToolHandler for glob tool calls
 */
export function createGlobHandler(
  manager: SandboxManager,
): ActivityToolHandler<GlobArgs, GlobResult> {
  return async (args, context) => {
    const { sandboxId } = context;

    if (!sandboxId) {
      return {
        toolResponse:
          "Error: No sandbox configured for this agent. The Glob tool requires a sandbox.",
        data: { files: [] },
      };
    }

    const { fs } = manager.getSandbox(sandboxId);
    const { pattern, root = "/" } = args;

    try {
      const allFiles = await walk(fs, root);
      const relativeTo = root.endsWith("/") ? root : `${root}/`;
      const matched = allFiles
        .map((f) => (f.startsWith(relativeTo) ? f.slice(relativeTo.length) : f))
        .filter((f) => matchGlob(pattern, f));

      return {
        toolResponse:
          matched.length > 0
            ? `Found ${matched.length} file(s):\n${matched.join("\n")}`
            : `No files matched pattern "${pattern}"`,
        data: { files: matched },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        toolResponse: `Error running glob: ${message}`,
        data: { files: [] },
      };
    }
  };
}
