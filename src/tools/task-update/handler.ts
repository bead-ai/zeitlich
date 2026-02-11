import type {
  AgentStateManager,
  JsonSerializable,
} from "../../lib/state-manager";
import type { ToolHandler } from "../../lib/tool-router";
import type { WorkflowTask } from "../../lib/types";
import type { TaskUpdateArgs } from "./tool";

/**
 * Creates a TaskUpdate handler that modifies task status and dependencies.
 *
 * @param stateManager - State manager containing tasks state
 * @returns A ToolHandler for TaskUpdate tool calls
 */
export function createTaskUpdateHandler<
  TCustom extends JsonSerializable<TCustom>,
>(
  stateManager: AgentStateManager<TCustom>
): ToolHandler<TaskUpdateArgs, WorkflowTask | null> {
  return (args) => {
    const task = stateManager.getTask(args.taskId);

    if (!task) {
      return {
        toolResponse: JSON.stringify({ error: `Task not found: ${args.taskId}` }),
        data: null,
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
      toolResponse: JSON.stringify(task, null, 2),
      data: task,
    };
  };
}
