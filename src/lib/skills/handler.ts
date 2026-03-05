import type { Skill } from "./types";
import type { ToolHandlerResponse } from "../tool-router";
import type { ReadSkillArgs } from "./tool";

/**
 * Creates a ReadSkill handler that looks up skills from an in-memory array.
 * Runs directly in the workflow (like task tools) — no activity needed.
 */
export function createReadSkillHandler(
  skills: Skill[]
): (args: ReadSkillArgs) => ToolHandlerResponse<null> {
  const skillMap = new Map(skills.map((s) => [s.name, s]));

  return (args: ReadSkillArgs): ToolHandlerResponse<null> => {
    const skill = skillMap.get(args.skill_name);

    if (!skill) {
      return {
        toolResponse: JSON.stringify({
          error: `Skill "${args.skill_name}" not found`,
        }),
        data: null,
      };
    }

    return {
      toolResponse: skill.instructions,
      data: null,
    };
  };
}
