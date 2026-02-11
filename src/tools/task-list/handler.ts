import type {
  AgentStateManager,
  JsonSerializable,
} from "../../lib/state-manager";
import type { ToolHandler } from "../../lib/tool-router";
import type { WorkflowTask } from "../../lib/types";
import type { TaskListArgs } from "./tool";

/**
 * Creates a TaskList handler that returns all tasks.
 *
 * @param stateManager - State manager containing tasks state
 * @returns A ToolHandler for TaskList tool calls
 */
export function createTaskListHandler<
  TCustom extends JsonSerializable<TCustom>,
>(
  stateManager: AgentStateManager<TCustom>
): ToolHandler<TaskListArgs, WorkflowTask[]> {
  return () => {
    const taskList = stateManager.getTasks();

    return {
      toolResponse: JSON.stringify(taskList, null, 2),
      data: taskList,
    };
  };
}
