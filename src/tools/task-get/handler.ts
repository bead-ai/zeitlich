import type { ToolHandlerResponse } from "../../lib/tool-router";
import type { WorkflowTask } from "../../lib/types";
import type { TaskGetToolSchemaType } from "./tool";

/**
 * Creates a TaskGet handler that retrieves a task by ID.
 *
 * @param tasks - Map storing workflow tasks
 * @returns A tool handler function
 *
 * @example
 * const tasks = new Map<string, WorkflowTask>();
 * const handler = createTaskGetHandler(tasks);
 */
export function createTaskGetHandler(
  tasks: Map<string, WorkflowTask>
): (
  args: TaskGetToolSchemaType,
  toolCallId: string
) => ToolHandlerResponse<WorkflowTask | null> {
  return (
    args: TaskGetToolSchemaType,
    _toolCallId: string
  ): ToolHandlerResponse<WorkflowTask | null> => {
    const task = tasks.get(args.taskId) ?? null;

    if (!task) {
      return {
        content: JSON.stringify({ error: `Task not found: ${args.taskId}` }),
        result: null,
      };
    }

    return {
      content: JSON.stringify(task, null, 2),
      result: task,
    };
  };
}
