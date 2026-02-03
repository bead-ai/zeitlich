import type {
  AgentStateManager,
  JsonSerializable,
} from "../../lib/state-manager";
import type { ToolHandlerResponse } from "../../lib/tool-router";
import type { WorkflowTask } from "../../lib/types";

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
): (
  args: Record<string, never>,
  toolCallId: string
) => ToolHandlerResponse<WorkflowTask[]> {
  return (
    _args: Record<string, never>,
    _toolCallId: string
  ): ToolHandlerResponse<WorkflowTask[]> => {
    const taskList = stateManager.getTasks();

    return {
      content: JSON.stringify(taskList, null, 2),
      result: taskList,
    };
  };
}
