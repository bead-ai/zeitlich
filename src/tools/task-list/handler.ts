import type { ToolHandlerResponse } from "../../lib/tool-router";
import type { WorkflowTask } from "../../lib/types";

/**
 * Creates a TaskList handler that returns all tasks.
 *
 * @param tasks - Map storing workflow tasks
 * @returns A tool handler function
 *
 * @example
 * const tasks = new Map<string, WorkflowTask>();
 * const handler = createTaskListHandler(tasks);
 */
export function createTaskListHandler(
  tasks: Map<string, WorkflowTask>
): (
  args: Record<string, never>,
  toolCallId: string
) => ToolHandlerResponse<WorkflowTask[]> {
  return (
    _args: Record<string, never>,
    _toolCallId: string
  ): ToolHandlerResponse<WorkflowTask[]> => {
    const taskList = Array.from(tasks.values());

    return {
      content: JSON.stringify(taskList, null, 2),
      result: taskList,
    };
  };
}
