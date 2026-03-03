import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Skill, SkillMetadata, SkillProvider } from "./types";
import { parseSkillFile } from "./parse";

/**
 * Loads skills from a filesystem directory following the agentskills.io layout:
 *
 * ```
 * skills/
 * ├── code-review/
 * │   └── SKILL.md
 * ├── pdf-processing/
 * │   └── SKILL.md
 * ```
 *
 * Activity-side only — cannot be used in Temporal workflow code.
 */
export class FileSystemSkillProvider implements SkillProvider {
  constructor(private readonly baseDir: string) {}

  async listSkills(): Promise<SkillMetadata[]> {
    const dirs = await this.discoverSkillDirs();
    const skills: SkillMetadata[] = [];

    for (const dir of dirs) {
      const raw = await readFile(join(this.baseDir, dir, "SKILL.md"), "utf-8");
      const { frontmatter } = parseSkillFile(raw);
      skills.push(frontmatter);
    }

    return skills;
  }

  async getSkill(name: string): Promise<Skill> {
    const raw = await readFile(
      join(this.baseDir, name, "SKILL.md"),
      "utf-8"
    );
    const { frontmatter, body } = parseSkillFile(raw);

    if (frontmatter.name !== name) {
      throw new Error(
        `Skill directory "${name}" contains SKILL.md with mismatched name "${frontmatter.name}"`
      );
    }

    return { ...frontmatter, instructions: body };
  }

  /**
   * Convenience method to load all skills with full instructions.
   * Returns `Skill[]` ready to pass into a workflow.
   */
  async loadAll(): Promise<Skill[]> {
    const dirs = await this.discoverSkillDirs();
    const skills: Skill[] = [];

    for (const dir of dirs) {
      const raw = await readFile(join(this.baseDir, dir, "SKILL.md"), "utf-8");
      const { frontmatter, body } = parseSkillFile(raw);
      skills.push({ ...frontmatter, instructions: body });
    }

    return skills;
  }

  private async discoverSkillDirs(): Promise<string[]> {
    const entries = await readdir(this.baseDir, { withFileTypes: true });
    const dirs: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        await readFile(join(this.baseDir, entry.name, "SKILL.md"), "utf-8");
        dirs.push(entry.name);
      } catch {
        // No SKILL.md — skip
      }
    }

    return dirs;
  }
}
