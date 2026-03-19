import type { ToolMap } from "../tool-router/types";
import type { Skill, SkillMetadata, SkillProvider } from "./types";
import { createReadSkillTool } from "./tool";
import { createReadSkillHandler } from "./handler";
import { createReadSkillReferenceTool } from "./reference-tool";
import { createReadSkillReferenceHandler } from "./reference-handler";

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

/**
 * Builds a fully wired tool entry for the ReadSkillReference tool.
 *
 * Returns null if no skills have references or the provider does not
 * implement `getReference`.
 */
export function buildSkillReferenceRegistration(
  skills: SkillMetadata[],
  provider: SkillProvider
): ToolMap[string] | null {
  if (!provider.getReference) return null;

  const skillsWithRefs = skills.filter(
    (s) => s.references && s.references.length > 0
  );
  if (skillsWithRefs.length === 0) return null;

  validateSkillNames(skills);

  return {
    ...createReadSkillReferenceTool(skills),
    handler: createReadSkillReferenceHandler(provider),
  };
}
