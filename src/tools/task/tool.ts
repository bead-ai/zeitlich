import z from "zod";
import type { SubagentConfig } from "../../lib/types";

const TASK_TOOL = "Task" as const;

/**
 * Builds the tool description with available subagent information
 */
function buildTaskDescription(subagents: SubagentConfig[]): string {
  const subagentList = subagents
    .map((s) => `- **${s.name}**: ${s.description}`)
    .join("\n");

  return `Launch a new agent to handle complex, multi-step tasks autonomously.

The ${TASK_TOOL} tool launches specialized agents (subprocesses) that autonomously handle complex tasks. Each agent type has specific capabilities and tools available to it.

Available agent types:

${subagentList}

When using the ${TASK_TOOL} tool, you must specify a subagent parameter to select which agent type to use.

Usage notes:

- Always include a short description (3-5 words) summarizing what the agent will do
- Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses
- When the agent is done, it will return a single message back to you. The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result.
- Each invocation starts fresh - provide a detailed task description with all necessary context.
- Provide clear, detailed prompts so the agent can work autonomously and return exactly the information you need.
- The agent's outputs should generally be trusted
- Clearly tell the agent what type of work you expect since it is not aware of the user's intent
- If the agent description mentions that it should be used proactively, then you should try your best to use it without the user having to ask for it first. Use your judgement.`;
}

/**
 * Creates a Task tool configured with the available subagents.
 *
 * @param subagents - Array of subagent configurations (must have at least one)
 * @returns A tool definition with dynamic schema based on available subagents
 *
 * @example
 * const taskTool = createTaskTool([
 *   {
 *     name: "researcher",
 *     description: "Researches topics and gathers information",
 *     workflowType: "researcherWorkflow",
 *     resultSchema: z.object({ findings: z.string() }),
 *   },
 * ]);
 */
export function createTaskTool<T extends SubagentConfig[]>(
  subagents: T
): {
  name: string;
  description: string;
  schema: z.ZodObject<{
    subagent: z.ZodEnum<Record<string, string>>;
    description: z.ZodString;
    prompt: z.ZodString;
  }>;
} {
  if (subagents.length === 0) {
    throw new Error("createTaskTool requires at least one subagent");
  }

  const names = subagents.map((s) => s.name);

  return {
    name: TASK_TOOL,
    description: buildTaskDescription(subagents),
    schema: z.object({
      subagent: z.enum(names).describe("The type of subagent to launch"),
      description: z
        .string()
        .describe("A short (3-5 word) description of the task"),
      prompt: z.string().describe("The task for the agent to perform"),
    }),
  } as const;
}

/**
 * Infer the schema type for a task tool created with specific subagents
 */
export type TaskToolSchemaType<T extends SubagentConfig[]> = z.infer<
  ReturnType<typeof createTaskTool<T>>["schema"]
>;

/**
 * Generic task tool schema type (when subagent names are not known at compile time)
 */
export type GenericTaskToolSchemaType = {
  subagent: string;
  description: string;
  prompt: string;
};
