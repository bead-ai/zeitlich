import z from "zod";
import type { ToolDefinition } from "../../lib/tool-router";

export const taskGetTool = {
  name: "TaskGet" as const,
  description: `Retrieve full task details including dependencies.`,
  schema: z.object({
    taskId: z.string().describe("The ID of the task to get"),
  }),
} satisfies ToolDefinition;

export type TaskGetArgs = z.infer<typeof taskGetTool.schema>;
