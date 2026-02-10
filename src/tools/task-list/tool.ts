import z from "zod";
import type { ToolDefinition } from "../../lib/tool-router";

export const taskListTool = {
  name: "TaskList" as const,
  description: `List all tasks with current state.`,
  schema: z.object({}),
} satisfies ToolDefinition;

export type TaskListArgs = z.infer<typeof taskListTool.schema>;
