import { executeChild, workflowInfo, uuid4 } from "@temporalio/workflow";
import type { ToolHandlerResponse } from "../../lib/tool-router";
import type { SubagentConfig, SubagentInput } from "../../lib/types";
import type { TaskArgs } from "./tool";

/**
 * Result from a task handler execution
 */
export interface TaskHandlerResult<TResult = unknown> {
  /** The validated result from the child workflow */
  result: TResult;
  /** The child workflow ID (for reference/debugging) */
  childWorkflowId: string;
}

/**
 * Creates a Task tool handler that spawns child workflows for configured subagents.
 *
 * @param subagents - Array of subagent configurations
 * @returns A tool handler function that can be used with the tool router
 *
 * @example
 * const taskHandler = taskHandler([
 *   {
 *     name: "researcher",
 *     description: "Researches topics",
 *     workflow: "researcherWorkflow",
 *     resultSchema: z.object({ findings: z.string() }),
 *   },
 * ]);
 */
export function createTaskHandler(subagents: SubagentConfig[]) {
  const { workflowId: parentWorkflowId, taskQueue: parentTaskQueue } =
    workflowInfo();

  return async (
    args: TaskArgs
  ): Promise<ToolHandlerResponse<TaskHandlerResult>> => {
    const config = subagents.find((s) => s.name === args.subagent);

    if (!config) {
      throw new Error(
        `Unknown subagent: ${args.subagent}. Available: ${subagents.map((s) => s.name).join(", ")}`
      );
    }

    const childWorkflowId = `${parentWorkflowId}-${args.subagent}-${uuid4()}`;

    // Execute the child workflow
    const input: SubagentInput = {
      prompt: args.prompt,
      ...(config.context && { context: config.context }),
    };

    const childOpts = {
      workflowId: childWorkflowId,
      args: [input],
      taskQueue: config.taskQueue ?? parentTaskQueue,
    };

    const childResult =
      typeof config.workflow === "string"
        ? await executeChild(config.workflow, childOpts)
        : await executeChild(config.workflow, childOpts);

    // Validate result if schema provided, otherwise pass through as-is
    const validated = config.resultSchema
      ? config.resultSchema.parse(childResult)
      : childResult;

    // Format content - stringify objects, pass strings through
    const toolResponse =
      typeof validated === "string"
        ? validated
        : JSON.stringify(validated, null, 2);

    return {
      toolResponse,
      data: {
        result: validated,
        childWorkflowId,
      },
    };
  };
}
