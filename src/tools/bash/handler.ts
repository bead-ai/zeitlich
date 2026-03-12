import type { ExecResult } from "../../lib/sandbox/types";
import type { ActivityToolHandler } from "../../lib/tool-router";
import type { SandboxContext } from "../../lib/tool-router/with-sandbox";
import type { BashArgs } from "./tool";

/**
 * Bash tool handler — executes shell commands inside a {@link Sandbox}.
 *
 * Wrap with {@link withSandbox} at activity registration time to inject the
 * sandbox automatically.
 */
export const bashHandler: ActivityToolHandler<
  BashArgs,
  ExecResult | null,
  SandboxContext
> = async (args, { sandbox }) => {
  try {
    const result = await sandbox.exec(args.command);
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
