import type {
  AgentStateManager,
  JsonSerializable,
} from "../../lib/state-manager";
import type { ToolHandlerResponse } from "../../lib/tool-router";
import type { WorkflowTask } from "../../lib/types";
import type { TaskGetToolSchemaType } from "./tool";

/**
 * Creates a TaskGet handler that retrieves a task by ID.
 *
 * @param stateManager - State manager containing tasks state
 * @returns A tool handler function
 *
 * @example
 * const handler = createTaskGetHandler(stateManager);
 */
export function createTaskGetHandler<TCustom extends JsonSerializable<TCustom>>(
  stateManager: AgentStateManager<TCustom>
): (args: TaskGetToolSchemaType) => ToolHandlerResponse<WorkflowTask | null> {
  return (
    args: TaskGetToolSchemaType
  ): ToolHandlerResponse<WorkflowTask | null> => {
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
