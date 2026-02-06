import z from "zod";

export const createBashToolDescription = ({
  fileTree,
}: {
  fileTree: string;
}): string => `Execute shell commands in a bash environment.

Use this tool to:
- Run shell commands (ls, cat, grep, find, etc.)
- Execute scripts and chain commands with pipes (|) or logical operators (&&, ||)
- Inspect files and directories

Current file tree:
${fileTree}`;

export const bashTool = {
  name: "Bash" as const,
  description: `Execute shell commands in a sandboxed bash environment.

Use this tool to:
- Run shell commands (ls, cat, grep, find, etc.)
- Execute scripts and chain commands with pipes (|) or logical operators (&&, ||)
- Inspect files and directories
`,
  schema: z.object({
    command: z
      .string()
      .describe(
        "The bash command to execute. Can include pipes (|), redirects (>, >>), logical operators (&&, ||), and shell features like command substitution $(...)."
      ),
  }),
  strict: true,
};

export type bashToolSchemaType = z.infer<typeof bashTool.schema>;
