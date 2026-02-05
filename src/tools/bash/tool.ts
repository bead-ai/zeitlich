import z from "zod";

export const bashTool = {
  name: "bashTool" as const,
  description: "tool to execute bash commands",
  schema: z.object({
    command: z
      .string()
      .describe("stringified command to be executed inside the Bash"),
  }),
  strict: true,
};

export type bashToolSchemaType = z.infer<typeof bashTool.schema>;
