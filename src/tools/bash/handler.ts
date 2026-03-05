import type { ActivityToolHandler } from "../../lib/tool-router";
import type { BashArgs } from "./tool";
import type { Sandbox, ExecResult } from "../../lib/sandbox/types";

type GetSandbox = (id: string) => Sandbox;

/**
 * Creates a Bash tool handler that executes shell commands via a {@link Sandbox}.
 *
 * @param getSandbox - Looks up the sandbox for the given ID (typically `SandboxManager.getSandbox`)
 * @returns Activity tool handler for Bash tool calls
 *
 * @example
 * ```typescript
 * import { createBashHandler, SandboxManager } from 'zeitlich';
 *
 * const manager = new SandboxManager(provider);
 * const bashHandler = createBashHandler(manager.getSandbox.bind(manager));
 * ```
 */
export const createBashHandler: (
  getSandbox: GetSandbox,
) => ActivityToolHandler<BashArgs, ExecResult | null> =
  (getSandbox) =>
  async (args, context) => {
    const sandboxId = (context as Record<string, unknown>)?.sandboxId as
      | string
      | undefined;

    if (!sandboxId) {
      return {
        toolResponse:
          "Error: No sandbox configured for this agent. The Bash tool requires a sandbox.",
        data: null,
      };
    }

    const sandbox = getSandbox(sandboxId);
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
