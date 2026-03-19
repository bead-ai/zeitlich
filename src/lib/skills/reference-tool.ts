import z from "zod";
import type { SkillMetadata } from "./types";

export const READ_SKILL_REFERENCE_TOOL_NAME = "ReadSkillReference" as const;

function buildDescription(skills: SkillMetadata[]): string {
  const skillList = skills
    .filter((s) => s.references && s.references.length > 0)
    .map((s) => `- **${s.name}**: ${s.references?.join(", ")}`)
    .join("\n");

  return `Load the content of a reference file for a skill.

# Available references by skill:
${skillList}
`;
}

/**
 * Creates a ReadSkillReference tool configured with the available skills.
 * Only skills that have references are included in the schema enum.
 */
export function createReadSkillReferenceTool(skills: SkillMetadata[]): {
  name: string;
  description: string;
  schema: z.ZodObject<{
    skill_name: z.ZodEnum<Record<string, string>>;
    reference_name: z.ZodString;
  }>;
} {
  const skillsWithRefs = skills.filter(
    (s) => s.references && s.references.length > 0
  );

  if (skillsWithRefs.length === 0) {
    throw new Error(
      "createReadSkillReferenceTool requires at least one skill with references"
    );
  }

  const names = skillsWithRefs.map((s) => s.name);

  return {
    name: READ_SKILL_REFERENCE_TOOL_NAME,
    description: buildDescription(skills),
    schema: z.object({
      skill_name: z
        .enum(names)
        .describe("The name of the skill that owns the reference"),
      reference_name: z
        .string()
        .describe("The name of the reference file (without .md extension)"),
    }),
  } as const;
}

export type ReadSkillReferenceArgs = {
  skill_name: string;
  reference_name: string;
};
