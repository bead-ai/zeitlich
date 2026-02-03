import z from "zod";

export const taskListTool = {
  name: "TaskList" as const,
  description: `List all tasks with current state.`,
  schema: z.object({}),
};

export type TaskListToolSchemaType = z.infer<typeof taskListTool.schema>;
