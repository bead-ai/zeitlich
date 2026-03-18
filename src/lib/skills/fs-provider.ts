import { join } from "node:path";
import type { SandboxFileSystem } from "../sandbox/types";
import { parseSkillFile } from "./parse";
import type { Skill, SkillMetadata, SkillProvider } from "./types";

/**
 * Loads skills from a directory following the agentskills.io layout:
 *
 * ```
 * skills/
 * ├── code-review/
 * │   └── SKILL.md
 * ├── pdf-processing/
 * │   └── SKILL.md
 * ```
 *
 * Uses the sandbox filesystem abstraction — works with any backend
 * (in-memory, host FS, Wasmer, Daytona, etc.).
 */
export class FileSystemSkillProvider implements SkillProvider {
  constructor(
    private readonly fs: SandboxFileSystem,
    private readonly baseDir: string,
  ) {}

  async listSkills(): Promise<SkillMetadata[]> {
    const dirs = await this.discoverSkillDirs();
    const skills: SkillMetadata[] = [];

    for (const dir of dirs) {
      const raw = await this.fs.readFile(join(this.baseDir, dir, "SKILL.md"));
      const { frontmatter } = parseSkillFile(raw);
      skills.push(frontmatter);
    }

    return skills;
  }

  async getSkill(name: string): Promise<Skill> {
    const raw = await this.fs.readFile(join(this.baseDir, name, "SKILL.md"));
    const { frontmatter, body } = parseSkillFile(raw);

    if (frontmatter.name !== name) {
      throw new Error(
        `Skill directory "${name}" contains SKILL.md with mismatched name "${frontmatter.name}"`,
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
      const raw = await this.fs.readFile(join(this.baseDir, dir, "SKILL.md"));
      const { frontmatter, body } = parseSkillFile(raw);
      skills.push({ ...frontmatter, instructions: body });
    }

    return skills;
  }

  private async discoverSkillDirs(): Promise<string[]> {
    const entries = await this.fs.readdirWithFileTypes(this.baseDir);
    const dirs: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      const skillPath = join(this.baseDir, entry.name, "SKILL.md");
      if (await this.fs.exists(skillPath)) {
        dirs.push(entry.name);
      }
    }

    return dirs;
  }
}
