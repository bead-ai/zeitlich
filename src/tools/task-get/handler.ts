import type {
  AgentStateManager,
  JsonSerializable,
} from "../../lib/state-manager";
import type { ToolHandler } from "../../lib/tool-router";
import type { WorkflowTask } from "../../lib/types";
import type { TaskGetArgs } from "./tool";

/**
 * Creates a TaskGet handler that retrieves a task by ID.
 *
 * @param stateManager - State manager containing tasks state
 * @returns A ToolHandler for TaskGet tool calls
 */
export function createTaskGetHandler<TCustom extends JsonSerializable<TCustom>>(
  stateManager: AgentStateManager<TCustom>
): ToolHandler<TaskGetArgs, WorkflowTask | null> {
  return (args) => {
    const task = stateManager.getTask(args.taskId) ?? null;

    if (!task) {
      return {
        toolResponse: JSON.stringify({ error: `Task not found: ${args.taskId}` }),
        data: null,
      };
    }

    return {
      toolResponse: JSON.stringify(task, null, 2),
      data: task,
    };
  };
}
