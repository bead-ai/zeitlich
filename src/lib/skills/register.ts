import type { ToolMap } from "../tool-router/types";
import type { Skill, SkillMetadata } from "./types";
import { createReadSkillTool } from "./tool";
import { createReadSkillHandler } from "./handler";

/**
 * Validates that all skill names are unique. Throws immediately if duplicates
 * are found so misconfiguration is caught at session wiring time.
 */
function validateSkillNames(skills: SkillMetadata[]): void {
  const names = skills.map((s) => s.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length > 0) {
    throw new Error(
      `Duplicate skill names: ${[...new Set(dupes)].join(", ")}`
    );
  }
}

/**
 * Builds a fully wired tool entry for the ReadSkill tool.
 *
 * Returns null if no skills are provided.
 */
export function buildSkillRegistration(
  skills: Skill[]
): ToolMap[string] | null {
  if (skills.length === 0) return null;

  validateSkillNames(skills);

  return {
    ...createReadSkillTool(skills),
    handler: createReadSkillHandler(skills),
  };
}
