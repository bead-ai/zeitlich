import type { ActivityToolHandler } from "../../lib/tool-router";
import type { BashArgs } from "./tool";
import type { ExecResult } from "../../lib/sandbox/types";
import type { SandboxManager } from "../../lib/sandbox/manager";

/**
 * Creates a Bash tool handler that executes shell commands via a {@link Sandbox}.
 *
 * @param manager - The {@link SandboxManager} instance that holds live sandboxes
 * @returns Activity tool handler for Bash tool calls
 */
export const createBashHandler: (
  manager: SandboxManager,
) => ActivityToolHandler<BashArgs, ExecResult | null> =
  (manager) =>
  async (args, context) => {
    const { sandboxId } = context;

    if (!sandboxId) {
      return {
        toolResponse:
          "Error: No sandbox configured for this agent. The Bash tool requires a sandbox.",
        data: null,
      };
    }

    const sandbox = manager.getSandbox(sandboxId);
    const { command } = args;

    try {
      const result = await sandbox.exec(command);
      return {
        toolResponse: `Exit code: ${result.exitCode}\n\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`,
        data: result,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error("Unknown error");
      return {
        toolResponse: `Error executing bash command: ${err.message}`,
        data: null,
      };
    }
  };
