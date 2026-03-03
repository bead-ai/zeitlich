import { executeChild, workflowInfo, uuid4 } from "@temporalio/workflow";
import type { ToolHandlerResponse } from "../../lib/tool-router";
import type {
  InferSubagentResult,
  SubagentConfig,
  SubagentInput,
} from "../../lib/types";
import type { SubagentArgs } from "./tool";
import type { z } from "zod";

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
  const { taskQueue: parentTaskQueue } = workflowInfo();

  return async (
    args: SubagentArgs
  ): Promise<ToolHandlerResponse<InferSubagentResult<T[number]> | null>> => {
    const config = subagents.find((s) => s.agentName === args.subagent);

    if (!config) {
      throw new Error(
        `Unknown subagent: ${args.subagent}. Available: ${subagents.map((s) => s.agentName).join(", ")}`
      );
    }

    const childWorkflowId = `${args.subagent}-${uuid4()}`;

    // Execute the child workflow
    const input: SubagentInput = {
      prompt: args.prompt,
      ...(config.context && { context: config.context }),
    };

    const childOpts = {
      workflowId: childWorkflowId,
      args: [input] as const,
      taskQueue: config.taskQueue ?? parentTaskQueue,
    };

    const { toolResponse, data, usage } =
      typeof config.workflow === "string"
        ? await executeChild(config.workflow, childOpts)
        : await executeChild(config.workflow, childOpts);

    if (!toolResponse) {
      return {
        toolResponse: "Subagent workflow returned no response",
        data: null,
        ...(usage && { usage }),
      };
    }

    // Validate result if schema provided, otherwise pass through as-is
    const validated = (
      config.resultSchema ? config.resultSchema.safeParse(data) : null
    ) as z.ZodSafeParseResult<InferSubagentResult<T[number]>> | null;

    if (validated && !validated.success) {
      return {
        toolResponse: `Subagent workflow returned invalid data: ${validated.error.message}`,
        data: null,
        ...(usage && { usage }),
      };
    }

    return {
      toolResponse,
      data: validated ? validated.data : data,
      ...(usage && { usage }),
    };
  };
}
