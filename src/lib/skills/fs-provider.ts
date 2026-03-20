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
 * │   ├── SKILL.md
 * │   ├── references/
 * │   │   └── spec-summary.md
 * │   └── scripts/
 * │       └── extract.py
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
      const location = join(this.baseDir, dir);
      skills.push({
        ...frontmatter,
        location,
      });
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

    const location = join(this.baseDir, name);
    const resourcePaths = await this.discoverResources(name);
    const resourceContents = await this.readResourceContents(location, resourcePaths);
    return {
      ...frontmatter,
      instructions: body,
      location,
      ...(resourceContents && { resourceContents }),
    };
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
      const location = join(this.baseDir, dir);
      const resourcePaths = await this.discoverResources(dir);
      const resourceContents = await this.readResourceContents(location, resourcePaths);
      skills.push({
        ...frontmatter,
        instructions: body,
        location,
        ...(resourceContents && { resourceContents }),
      });
    }

    return skills;
  }

  /**
   * Scans the standard resource subdirectories (references/, scripts/, assets/)
   * and returns relative paths for all discovered files.
   */
  private async discoverResources(skillDir: string): Promise<string[]> {
    const resourceDirs = ["references", "scripts", "assets"];
    const resources: string[] = [];

    for (const subdir of resourceDirs) {
      const dirPath = join(this.baseDir, skillDir, subdir);
      if (!(await this.fs.exists(dirPath))) continue;
      const entries = await this.fs.readdirWithFileTypes(dirPath);
      for (const e of entries) {
        if (e.isFile) {
          resources.push(`${subdir}/${e.name}`);
        }
      }
    }

    return resources;
  }

  private async readResourceContents(
    location: string,
    resources: string[],
  ): Promise<Record<string, string> | undefined> {
    if (resources.length === 0) return undefined;
    const contents: Record<string, string> = {};
    for (const r of resources) {
      contents[r] = await this.fs.readFile(join(location, r));
    }
    return contents;
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
