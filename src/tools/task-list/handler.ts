import type {
  AgentStateManager,
  JsonSerializable,
} from "../../lib/state-manager";
import type { ToolHandlerResponse } from "../../lib/tool-router";
import type { WorkflowTask } from "../../lib/types";
import type { TaskListToolSchemaType } from "./tool";

/**
 * Creates a TaskList handler that returns all tasks.
 *
 * @param stateManager - State manager containing tasks state
 * @returns A tool handler function
 *
 * @example
 * const handler = createTaskListHandler(stateManager);
 */
export function createTaskListHandler<
  TCustom extends JsonSerializable<TCustom>,
>(
  stateManager: AgentStateManager<TCustom>
): (args: TaskListToolSchemaType) => ToolHandlerResponse<WorkflowTask[]> {
  return (
    _args: TaskListToolSchemaType
  ): ToolHandlerResponse<WorkflowTask[]> => {
    const taskList = stateManager.getTasks();

    return {
      content: JSON.stringify(taskList, null, 2),
      result: taskList,
    };
  };
}
