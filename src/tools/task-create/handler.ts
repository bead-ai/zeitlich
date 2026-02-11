import type {
  AgentStateManager,
  JsonSerializable,
} from "../../lib/state-manager";
import type { ToolHandler } from "../../lib/tool-router";
import type { WorkflowTask } from "../../lib/types";
import type { TaskCreateArgs } from "./tool";
import { uuid4 } from "@temporalio/workflow";

/**
 * Creates a TaskCreate handler that adds tasks to the workflow state.
 *
 * @param stateManager - State manager containing tasks state
 * @returns A ToolHandler for TaskCreate tool calls
 */
export function createTaskCreateHandler<
  TCustom extends JsonSerializable<TCustom>,
>(
  stateManager: AgentStateManager<TCustom>
): ToolHandler<TaskCreateArgs, WorkflowTask> {
  return (args) => {
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
