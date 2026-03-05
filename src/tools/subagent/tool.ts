import z from "zod";
import type { SubagentConfig } from "../../lib/types";

export const SUBAGENT_TOOL_NAME = "Subagent" as const;

/**
 * Builds the tool description with available subagent information
 */
function buildSubagentDescription(subagents: SubagentConfig[]): string {
  const subagentList = subagents
    .map((s) => {
      const continuation = s.allowThreadContinuation
        ? "\n*(Supports thread continuation — pass a threadId to resume a previous conversation)*"
        : "";
      return `## ${s.agentName}\n${s.description}${continuation}`;
    })
    .join("\n\n");

  return `The ${SUBAGENT_TOOL_NAME} tool launches specialized agents (subagents) that autonomously handle complex work. Each agent type has specific capabilities and tools available to it.

# Available subagents:
${subagentList}
`;
}

/**
 * Creates a Subagent tool configured with the available subagents.
 *
 * @param subagents - Array of subagent configurations (must have at least one)
 * @returns A tool definition with dynamic schema based on available subagents
 *
 * @example
 * const subagentTool = createSubagentTool([
 *   {
 *     agentName: "researcher",
 *     description: "Researches topics and gathers information",
 *     workflow: "researcherWorkflow",
 *     resultSchema: z.object({ findings: z.string() }),
 *   },
 * ]);
 */
export function createSubagentTool<T extends SubagentConfig[]>(
  subagents: T
): {
  readonly name: typeof SUBAGENT_TOOL_NAME;
  readonly description: string;
  readonly schema: z.ZodObject<z.ZodRawShape>;
} {
  if (subagents.length === 0) {
    throw new Error("createTaskTool requires at least one subagent");
  }

  const names = subagents.map((s) => s.agentName);
  const hasThreadContinuation = subagents.some(
    (s) => s.allowThreadContinuation
  );

  const baseFields = {
    subagent: z.enum(names).describe("The type of subagent to launch"),
    description: z
      .string()
      .describe("A short (3-5 word) description of the task"),
    prompt: z.string().describe("The task for the agent to perform"),
  };

  const schema = hasThreadContinuation
    ? z.object({
        ...baseFields,
        threadId: z
          .string()
          .nullable()
          .describe(
            "Thread ID to continue an existing conversation, or null to start a new one"
          ),
      })
    : z.object(baseFields);

  return {
    name: SUBAGENT_TOOL_NAME,
    description: buildSubagentDescription(subagents),
    schema,
  } as const;
}

/**
 * Subagent tool args type (when subagent names are not known at compile time)
 */
export type SubagentArgs = {
  subagent: string;
  description: string;
  prompt: string;
  threadId?: string | null;
};
