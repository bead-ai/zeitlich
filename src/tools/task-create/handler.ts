import type {
  AgentStateManager,
  JsonSerializable,
} from "../../lib/state-manager";
import type { ToolHandlerResponse } from "../../lib/tool-router";
import type { WorkflowTask } from "../../lib/types";
import type { TaskCreateToolSchemaType } from "./tool";

/**
 * Creates a TaskCreate handler that adds tasks to the workflow state.
 *
 * @param tasks - Map storing workflow tasks
 * @param stateManager - State manager for version tracking
 * @param idGenerator - Function to generate unique task IDs (e.g., uuid4 from Temporal)
 * @returns A tool handler function
 *
 * @example
 * const tasks = new Map<string, WorkflowTask>();
 * const handler = createTaskCreateHandler(tasks, stateManager, uuid4);
 */
export function createTaskCreateHandler<
  TCustom extends JsonSerializable<TCustom>,
>(
  tasks: Map<string, WorkflowTask>,
  stateManager: AgentStateManager<TCustom>,
  idGenerator: () => string
): (
  args: TaskCreateToolSchemaType,
  toolCallId: string
) => ToolHandlerResponse<WorkflowTask> {
  return (
    args: TaskCreateToolSchemaType,
    _toolCallId: string
  ): ToolHandlerResponse<WorkflowTask> => {
    const task: WorkflowTask = {
      id: idGenerator(),
      subject: args.subject,
      description: args.description,
      activeForm: args.activeForm,
      status: "pending",
      metadata: args.metadata ?? {},
      blockedBy: [],
      blocks: [],
    };

    tasks.set(task.id, task);
    stateManager.incrementVersion();

    return {
      content: JSON.stringify(task, null, 2),
      result: task,
    };
  };
}
