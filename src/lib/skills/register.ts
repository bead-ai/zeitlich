import type { ToolMap } from "../tool-router/types";
import type { Skill } from "./types";
import { createReadSkillTool } from "./tool";
import { createReadSkillHandler } from "./handler";

/**
 * Builds a fully wired tool entry for the ReadSkill tool.
 *
 * Returns null if no skills are provided.
 */
export function buildSkillRegistration(
  skills: Skill[]
): ToolMap[string] | null {
  if (skills.length === 0) return null;

  return {
    ...createReadSkillTool(skills),
    handler: createReadSkillHandler(skills),
  };
}
