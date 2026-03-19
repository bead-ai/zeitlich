import { join } from "node:path";
import type { SandboxFileSystem } from "../sandbox/types";
import type { Skill, SkillMetadata, SkillProvider } from "./types";
import { parseSkillFile } from "./parse";

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
      const references = await this.discoverReferenceNames(dir);
      skills.push({ ...frontmatter, ...(references.length > 0 && { references }) });
    }

    return skills;
  }

  async getSkill(name: string): Promise<Skill> {
    const raw = await this.fs.readFile(
      join(this.baseDir, name, "SKILL.md"),
    );
    const { frontmatter, body } = parseSkillFile(raw);

    if (frontmatter.name !== name) {
      throw new Error(
        `Skill directory "${name}" contains SKILL.md with mismatched name "${frontmatter.name}"`,
      );
    }

    const references = await this.discoverReferenceNames(name);
    return { ...frontmatter, instructions: body, ...(references.length > 0 && { references }) };
  }

  async getReference(skillName: string, refName: string): Promise<string> {
    const refPath = join(this.baseDir, skillName, "references", `${refName}.md`);
    if (!(await this.fs.exists(refPath))) {
      throw new Error(`Reference "${refName}" not found in skill "${skillName}"`);
    }
    return this.fs.readFile(refPath);
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
      const references = await this.discoverReferenceNames(dir);
      skills.push({ ...frontmatter, instructions: body, ...(references.length > 0 && { references }) });
    }

    return skills;
  }

  private async discoverReferenceNames(skillDir: string): Promise<string[]> {
    const refsPath = join(this.baseDir, skillDir, "references");
    if (!(await this.fs.exists(refsPath))) return [];
    const entries = await this.fs.readdirWithFileTypes(refsPath);
    return entries
      .filter((e) => e.isFile && e.name.endsWith(".md"))
      .map((e) => e.name.slice(0, -3));
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
