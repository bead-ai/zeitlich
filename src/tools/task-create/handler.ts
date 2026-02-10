import type {
  AgentStateManager,
  JsonSerializable,
} from "../../lib/state-manager";
import type { ToolHandlerResponse } from "../../lib/tool-router";
import type { WorkflowTask } from "../../lib/types";
import type { TaskCreateToolSchemaType } from "./tool";
import { uuid4 } from "@temporalio/workflow";

/**
 * Creates a TaskCreate handler that adds tasks to the workflow state.
 *
 * @param stateManager - State manager containing tasks state
 * @param idGenerator - Function to generate unique task IDs (e.g., uuid4 from Temporal)
 * @returns A tool handler function
 *
 * @example
 * const handler = createTaskCreateHandler(stateManager, uuid4);
 */
export function createTaskCreateHandler<
  TCustom extends JsonSerializable<TCustom>,
>(
  stateManager: AgentStateManager<TCustom>
): (args: TaskCreateToolSchemaType) => ToolHandlerResponse<WorkflowTask> {
  return (
    args: TaskCreateToolSchemaType
  ): ToolHandlerResponse<WorkflowTask> => {
    const task: WorkflowTask = {
      id: uuid4(),
      subject: args.subject,
      description: args.description,
      activeForm: args.activeForm,
      status: "pending",
      metadata: args.metadata ?? {},
      blockedBy: [],
      blocks: [],
    };

    stateManager.setTask(task);

    return {
      toolResponse: JSON.stringify(task, null, 2),
      data: task,
    };
  };
}
