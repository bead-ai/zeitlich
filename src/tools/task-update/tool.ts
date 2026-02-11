import z from "zod";
import type { ToolDefinition } from "../../lib/tool-router";

export const taskUpdateTool = {
  name: "TaskUpdate" as const,
  description: `Update status, add blockers, modify details.`,
  schema: z.object({
    taskId: z.string().describe("The ID of the task to get"),
    status: z
      .enum(["pending", "in_progress", "completed"])
      .describe("The status of the task"),
    addBlockedBy: z
      .array(z.string())
      .describe("The IDs of the tasks that are blocking this task"),
    addBlocks: z
      .array(z.string())
      .describe("The IDs of the tasks that this task is blocking"),
  }),
} satisfies ToolDefinition;

export type TaskUpdateArgs = z.infer<typeof taskUpdateTool.schema>;
