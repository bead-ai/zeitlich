import z from "zod";
import type { SubagentConfig } from "./types";

export const SUBAGENT_TOOL_NAME = "Subagent" as const;

function buildSubagentDescription(subagents: SubagentConfig[]): string {
  const subagentList = subagents
    .map((s) => {
      const continuation = s.thread && s.thread !== "new"
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
 */
export function createSubagentTool<T extends SubagentConfig[]>(
  subagents: T
): {
  readonly name: typeof SUBAGENT_TOOL_NAME;
  readonly description: string;
  readonly schema: z.ZodObject<z.ZodRawShape>;
} {
  if (subagents.length === 0) {
    throw new Error("createSubagentTool requires at least one subagent");
  }

  const names = subagents.map((s) => s.agentName);
  const hasThreadContinuation = subagents.some(
    (s) => s.thread && s.thread !== "new"
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
            "Thread ID to continue an existing conversation from the same subagent, or null to start a new one"
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
