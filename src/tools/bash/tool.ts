import z from "zod";
import type { BashOptions } from "just-bash";

export const bashTool = {
    name: "bashTool" as const,
    description: "tool to execute bash commands",
    schema: z.object({
        command: z.string().describe("stringified command to be executed inside the Bash"),
        bashOptions: z.custom<BashOptions>().optional(),
    }),
    strict: true,
};

export type bashToolSchemaType = z.infer<typeof bashTool.schema>;