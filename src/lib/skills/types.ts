/**
 * Skill metadata — the lightweight subset loaded at startup for all skills.
 * Follows the agentskills.io specification frontmatter fields.
 */
export interface SkillMetadata {
  /** Lowercase alphanumeric + hyphens, max 64 chars, must match directory name */
  name: string;
  /** What the skill does and when to use it (max 1024 chars) */
  description: string;
  /** License name or reference to a bundled license file */
  license?: string;
  /** Environment requirements (intended product, system packages, network access) */
  compatibility?: string;
  /** Arbitrary key-value pairs for additional metadata */
  metadata?: Record<string, string>;
  /** Space-delimited list of pre-approved tools the skill may use */
  allowedTools?: string[];
  /** Absolute path to the skill directory (parent of SKILL.md) */
  location?: string;
}

/**
 * A fully-loaded skill including the SKILL.md instruction body.
 * Progressive disclosure: metadata is always available, instructions
 * are loaded on-demand via the ReadSkill tool.
 */
export interface Skill extends SkillMetadata {
  /** The markdown body of SKILL.md (everything after the frontmatter) */
  instructions: string;
  /** Resource file contents keyed by relative path (e.g. `references/overview.md` → content) */
  resourceContents?: Record<string, string>;
}

/**
 * Abstraction for discovering and loading skills.
 *
 * Implement this interface to provide skills from any source
 * (filesystem, database, API, in-memory, etc.).
 */
export interface SkillProvider {
  /** Return lightweight metadata for all available skills */
  listSkills(): Promise<SkillMetadata[]>;
  /** Load a single skill with full instructions by name */
  getSkill(name: string): Promise<Skill>;
  /** Load all skills with full instructions */
  loadAll(): Promise<Skill[]>;
}
