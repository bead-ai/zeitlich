import z from "zod";

export const createBashToolDescription = ({
  fileTree,
}: {
  fileTree: string;
}): string => `tool to execute bash commands, the file tree is: ${fileTree}`;

export const bashTool = {
  name: "Bash" as const,
  description: "tool to execute bash commands",
  schema: z.object({
    command: z
      .string()
      .describe("stringified command to be executed inside the Bash"),
  }),
  strict: true,
};

export type bashToolSchemaType = z.infer<typeof bashTool.schema>;
