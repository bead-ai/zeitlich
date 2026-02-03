import type { SubagentConfig } from "./types";
import type { ToolMap, ToolDefinition } from "./tool-registry";
import { createTaskTool } from "../tools/task/tool";
import { createTaskHandler } from "../tools/task/handler";
import type { ToolHandler } from "./tool-router";
import type { GenericTaskToolSchemaType } from "../tools/task/tool";
import type { TaskHandlerResult } from "../tools/task/handler";

/**
 * Configuration for subagent support
 */
export interface SubagentSupportConfig {
  /** Array of subagent configurations */
  subagents: SubagentConfig[];
}

/**
 * Result from withSubagentSupport - contains enhanced tools and the task handler
 */
export interface SubagentSupportResult<T extends ToolMap> {
  /** Combined tools (user tools + Task tool) */
  tools: T & { Task: ReturnType<typeof createTaskTool> };
  /** Task handler to be added to the tool router handlers */
  taskHandler: ToolHandler<GenericTaskToolSchemaType, TaskHandlerResult>;
}

/**
 * Adds subagent support to a tool map by including the Task tool and handler.
 *
 * Use this when you want to enable subagent spawning in your workflow.
 * The returned tools should be passed to createToolRegistry, and the
 * taskHandler should be included in your tool router handlers.
 *
 * @param userTools - Your workflow's existing tools
 * @param config - Subagent configuration
 * @returns Combined tools and the task handler
 *
 * @example
 * const { tools, taskHandler } = withSubagentSupport(
 *   { AskUserQuestion: askUserQuestionTool },
 *   {
 *     subagents: [
 *       {
 *         name: "researcher",
 *         description: "Researches and gathers information",
 *         workflowType: "researcherWorkflow",
 *         resultSchema: z.object({ findings: z.string() }),
 *       },
 *     ],
 *   }
 * );
 *
 * const toolRegistry = createToolRegistry(tools);
 * const toolRouter = createToolRouter(
 *   { registry: toolRegistry, threadId, appendToolResult },
 *   {
 *     AskUserQuestion: handleAskUserQuestion,
 *     Task: taskHandler,
 *   }
 * );
 */
export function withSubagentSupport<T extends ToolMap>(
  userTools: T,
  config: SubagentSupportConfig
): SubagentSupportResult<T> {
  if (config.subagents.length === 0) {
    throw new Error("withSubagentSupport requires at least one subagent");
  }

  const taskTool = createTaskTool(config.subagents);
  const taskHandler = createTaskHandler(config.subagents);

  return {
    tools: {
      ...userTools,
      Task: taskTool,
    } as T & { Task: ReturnType<typeof createTaskTool> },
    taskHandler,
  };
}

/**
 * Type guard to check if a tool map includes the Task tool
 */
export function hasTaskTool(
  tools: ToolMap
): tools is ToolMap & { Task: ToolDefinition } {
  return "Task" in tools;
}
