import z from "zod";

export const taskGetTool = {
  name: "TaskGet" as const,
  description: `Retrieve full task details including dependencies.`,
  schema: z.object({
    taskId: z.string().describe("The ID of the task to get"),
  }),
};

export type TaskGetToolSchemaType = z.infer<typeof taskGetTool.schema>;
