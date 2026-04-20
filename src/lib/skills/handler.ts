import type { Skill } from "./types";
import type { ToolHandlerResponse } from "../tool-router";
import type { ReadSkillArgs } from "./tool";

/**
 * Formats the skill activation response with structured wrapping.
 *
 * Follows the agentskills.io pattern: the instructions are wrapped in
 * identifying tags and bundled resources are listed so the agent can
 * load them on demand via its file-read tool.
 */
function formatSkillResponse(skill: Skill): string {
  const parts: string[] = [];

  parts.push(`<skill_content name="${skill.name}">`);
  parts.push(skill.instructions);

  if (skill.location) {
    parts.push(`\nSkill directory: ${skill.location}`);
    parts.push(
      "Relative paths in this skill resolve against the skill directory above."
    );
  }

  const resources = skill.resourceContents
    ? Object.keys(skill.resourceContents)
    : [];
  if (resources.length > 0) {
    parts.push("");
    parts.push("<skill_resources>");
    for (const r of resources) {
      parts.push(`  <file>${r}</file>`);
    }
    parts.push("</skill_resources>");
  }

  parts.push("</skill_content>");

  return parts.join("\n");
}

/**
 * Creates a ReadSkill handler that looks up skills from an in-memory array.
 * Runs directly in the workflow (like task tools) — no activity needed.
 *
 * The response uses structured wrapping per the agentskills.io spec:
 * instructions are enclosed in `<skill_content>` tags, the skill directory
 * is included, and bundled resources are listed so the agent can load them
 * individually via its file-read tool.
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
      toolResponse: formatSkillResponse(skill),
      data: null,
    };
  };
}
