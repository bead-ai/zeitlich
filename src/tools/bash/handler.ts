import type { ActivityToolHandler } from "../../workflow";
import type { bashToolSchemaType } from "./tool";
import { Bash } from "just-bash";

type BashExecOut = {
    exitCode: number,
    stderr: string,
    stdout: string,
}

export const handleBashTool: ActivityToolHandler<bashToolSchemaType, BashExecOut | null> = async (args: bashToolSchemaType) => {
    const { fs, command } = args;

    const bashOptions = fs ? { fs, } : {};

    const bash = new Bash(bashOptions);

    try {
        const { exitCode, stderr, stdout } = await bash.exec(command);
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