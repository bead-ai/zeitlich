import type {
  AgentStateManager,
  JsonSerializable,
} from "../../lib/state-manager";
import type { ToolHandlerResponse } from "../../lib/tool-router";
import type { WorkflowTask } from "../../lib/types";
import type { TaskUpdateToolSchemaType } from "./tool";

/**
 * Creates a TaskUpdate handler that modifies task status and dependencies.
 *
 * @param stateManager - State manager containing tasks state
 * @returns A tool handler function
 *
 * @example
 * const handler = createTaskUpdateHandler(stateManager);
 */
export function createTaskUpdateHandler<
  TCustom extends JsonSerializable<TCustom>,
>(
  stateManager: AgentStateManager<TCustom>
): (
  args: TaskUpdateToolSchemaType
) => ToolHandlerResponse<WorkflowTask | null> {
  return (
    args: TaskUpdateToolSchemaType
  ): ToolHandlerResponse<WorkflowTask | null> => {
    const task = stateManager.getTask(args.taskId);

    if (!task) {
      return {
        content: JSON.stringify({ error: `Task not found: ${args.taskId}` }),
        result: null,
      };
    }

    // Update status if provided
    if (args.status) {
      task.status = args.status;
    }

    // Add blockedBy relationships (bidirectional)
    if (args.addBlockedBy) {
      for (const blockerId of args.addBlockedBy) {
        if (!task.blockedBy.includes(blockerId)) {
          task.blockedBy.push(blockerId);
        }
        // Update the blocker task's blocks array
        const blockerTask = stateManager.getTask(blockerId);
        if (blockerTask && !blockerTask.blocks.includes(task.id)) {
          blockerTask.blocks.push(task.id);
          stateManager.setTask(blockerTask);
        }
      }
    }

    // Add blocks relationships (bidirectional)
    if (args.addBlocks) {
      for (const blockedId of args.addBlocks) {
        if (!task.blocks.includes(blockedId)) {
          task.blocks.push(blockedId);
        }
        // Update the blocked task's blockedBy array
        const blockedTask = stateManager.getTask(blockedId);
        if (blockedTask && !blockedTask.blockedBy.includes(task.id)) {
          blockedTask.blockedBy.push(task.id);
          stateManager.setTask(blockedTask);
        }
      }
    }

    stateManager.setTask(task);

    return {
      content: JSON.stringify(task, null, 2),
      result: task,
    };
  };
}
