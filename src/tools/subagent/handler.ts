import { executeChild, workflowInfo, uuid4 } from "@temporalio/workflow";
import type { ToolHandlerResponse } from "../../lib/tool-router";
import type {
  InferSubagentResult,
  SubagentConfig,
  SubagentInput,
} from "../../lib/types";
import type { SubagentArgs } from "./tool";

/**
 * Creates a Subagent tool handler that spawns child workflows for configured subagents.
 *
 * @param subagents - Array of subagent configurations
 * @returns A tool handler function that can be used with the tool router
 *
 * @example
 * const subagentHandler = subagentHandler([
 *   {
 *     name: "researcher",
 *     description: "Researches topics",
 *     workflow: "researcherWorkflow",
 *     resultSchema: z.object({ findings: z.string() }),
 *   },
 * ]);
 */
export function createSubagentHandler<
  const T extends readonly SubagentConfig[],
>(subagents: [...T]) {
  const { workflowId: parentWorkflowId, taskQueue: parentTaskQueue } =
    workflowInfo();

  return async (
    args: SubagentArgs
  ): Promise<ToolHandlerResponse<InferSubagentResult<T[number]> | null>> => {
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

    const { toolResponse, data } =
      typeof config.workflow === "string"
        ? await executeChild(config.workflow, childOpts)
        : await executeChild(config.workflow, childOpts);

    // Validate result if schema provided, otherwise pass through as-is
    const validated = (
      config.resultSchema ? config.resultSchema.parse(data) : null
    ) as InferSubagentResult<T[number]> | null;

    return {
      toolResponse,
      data: validated,
    };
  };
}
