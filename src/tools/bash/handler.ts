import type { ActivityToolHandler } from "../../lib/tool-router";
import type { BashArgs } from "./tool";
import { Bash, type BashOptions } from "just-bash";

type BashExecOut = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

/** BashOptions with `fs` required */
type BashToolOptions = Required<Pick<BashOptions, "fs">> & Omit<BashOptions, "fs">;

/**
 * Creates a Bash tool handler that executes shell commands in a sandboxed environment.
 *
 * @param bashOptions - Options including a required `fs` (file system implementation from `just-bash`)
 * @returns Activity tool handler for Bash tool calls
 *
 * @example
 * ```typescript
 * import { createBashHandler } from 'zeitlich';
 *
 * const bashHandlerActivity = createBashHandler({ fs: inMemoryFileSystem });
 * ```
 */
export const createBashHandler: (
    bashOptions: BashToolOptions,
) => ActivityToolHandler<BashArgs, BashExecOut | null> =
  (bashOptions: BashToolOptions) => async (args: BashArgs, _context) => {
    const { command } = args;

    const mergedOptions: BashOptions = {
      ...bashOptions,
      executionLimits: {
        maxStringLength: 52428800, // 50MB default
        ...bashOptions.executionLimits,
      },
    };

    const bash = new Bash(mergedOptions);

    try {
      const { exitCode, stderr, stdout } = await bash.exec(command);
      const bashExecOut = { exitCode, stderr, stdout };

      return {
        toolResponse: `Exit code: ${exitCode}\n\nstdout:\n${stdout}\n\nstderr:\n${stderr}`,
        data: bashExecOut,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error("Unknown error");
      return {
        toolResponse: `Error executing bash command: ${err.message}`,
        data: null,
      };
    }
  };
