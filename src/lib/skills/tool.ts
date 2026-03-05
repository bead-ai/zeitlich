import z from "zod";
import type { Skill } from "./types";

export const READ_SKILL_TOOL_NAME = "ReadSkill" as const;

function buildReadSkillDescription(skills: Skill[]): string {
  const skillList = skills
    .map((s) => `- **${s.name}**: ${s.description}`)
    .join("\n");

  return `Load the full instructions for a skill. Read the skill before following its instructions.

# Available skills:
${skillList}
`;
}

/**
 * Creates a ReadSkill tool configured with the available skills.
 * The tool description embeds skill metadata so the agent discovers
 * skills purely through the tool definition.
 */
export function createReadSkillTool(skills: Skill[]): {
  name: string;
  description: string;
  schema: z.ZodObject<{
    skill_name: z.ZodEnum<Record<string, string>>;
  }>;
} {
  if (skills.length === 0) {
    throw new Error("createReadSkillTool requires at least one skill");
  }

  const names = skills.map((s) => s.name);

  return {
    name: READ_SKILL_TOOL_NAME,
    description: buildReadSkillDescription(skills),
    schema: z.object({
      skill_name: z.enum(names).describe("The name of the skill to load"),
    }),
  } as const;
}

export type ReadSkillArgs = {
  skill_name: string;
};
