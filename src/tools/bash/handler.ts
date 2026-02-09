import type { ActivityToolHandler } from "../../workflow";
import type { bashToolSchemaType } from "./tool";
import { Sandbox } from "e2b";

type BashExecOut = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

export const handleBashTool: (
    sandboxId: string,
    E2B_API_KEY: string,
) => ActivityToolHandler<bashToolSchemaType, BashExecOut | null> =
  (sandboxId: string) => async (args: bashToolSchemaType, _context) => {
    const { command } = args;

    try {
      const sandbox = await Sandbox.connect(sandboxId);
      
      const commandResult = await sandbox.commands.run(command);
      const { exitCode, stderr, stdout } = commandResult;
      const bashExecOut = { exitCode, stderr, stdout };

      return {
        content: `Exit code: ${exitCode}\n\nstdout:\n${stdout}\n\nstderr:\n${stderr}`,
        result: bashExecOut,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error("Unknown error");
      return {
        content: `Error executing bash command: ${err.message}`,
        result: null,
      };
    }
  };
