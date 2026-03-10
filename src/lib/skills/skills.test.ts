import { describe, expect, it, beforeEach } from "vitest";
import { createReadSkillHandler } from "./handler";
import { createReadSkillTool, READ_SKILL_TOOL_NAME } from "./tool";
import { FileSystemSkillProvider } from "./fs-provider";
import { InMemorySandboxProvider } from "../../adapters/sandbox/inmemory/index";
import { SandboxManager } from "../sandbox/manager";
import type { Skill } from "./types";

const testSkills: Skill[] = [
  {
    name: "code-review",
    description: "Review code for quality",
    instructions: "Step 1: Read the code\nStep 2: Review it",
  },
  {
    name: "testing",
    description: "Write and run tests",
    license: "MIT",
    instructions: "Write good tests.",
  },
];

describe("createReadSkillHandler", () => {
  let handler: ReturnType<typeof createReadSkillHandler>;

  beforeEach(() => {
    handler = createReadSkillHandler(testSkills);
  });

  it("returns instructions for a known skill", () => {
    const result = handler({ skill_name: "code-review" });
    expect(result.toolResponse).toBe("Step 1: Read the code\nStep 2: Review it");
    expect(result.data).toBeNull();
  });

  it("returns error for unknown skill", () => {
    const result = handler({ skill_name: "nonexistent" });
    expect(result.toolResponse).toContain("not found");
  });
});

describe("createReadSkillTool", () => {
  it("creates a tool with skill names as enum", () => {
    const tool = createReadSkillTool(testSkills);
    expect(tool.name).toBe(READ_SKILL_TOOL_NAME);
    expect(tool.description).toContain("code-review");
    expect(tool.description).toContain("testing");
  });

  it("throws when no skills provided", () => {
    expect(() => createReadSkillTool([])).toThrow("at least one skill");
  });

  it("schema validates correct skill names", () => {
    const tool = createReadSkillTool(testSkills);
    const result = tool.schema.safeParse({ skill_name: "code-review" });
    expect(result.success).toBe(true);
  });

  it("schema rejects invalid skill names", () => {
    const tool = createReadSkillTool(testSkills);
    const result = tool.schema.safeParse({ skill_name: "invalid" });
    expect(result.success).toBe(false);
  });
});

describe("FileSystemSkillProvider", () => {
  const skillMd = (name: string, desc: string, body: string): string =>
    `---\nname: ${name}\ndescription: ${desc}\n---\n${body}`;

  it("lists skills from directory structure", async () => {
    const manager = new SandboxManager(new InMemorySandboxProvider());
    const { sandboxId } = await manager.create({
      initialFiles: {
        "/skills/code-review/SKILL.md": skillMd("code-review", "Review code", "Instructions here"),
        "/skills/testing/SKILL.md": skillMd("testing", "Run tests", "Test instructions"),
      },
    });
    const sandbox = await manager.getSandbox(sandboxId);
    const provider = new FileSystemSkillProvider(sandbox.fs, "/skills");
    const skills = await provider.listSkills();

    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.name);
    expect(names).toContain("code-review");
    expect(names).toContain("testing");
  });

  it("gets a single skill with instructions", async () => {
    const manager = new SandboxManager(new InMemorySandboxProvider());
    const { sandboxId } = await manager.create({
      initialFiles: {
        "/skills/code-review/SKILL.md": skillMd("code-review", "Review code", "Do the review."),
      },
    });
    const sandbox = await manager.getSandbox(sandboxId);
    const provider = new FileSystemSkillProvider(sandbox.fs, "/skills");
    const skill = await provider.getSkill("code-review");

    expect(skill.name).toBe("code-review");
    expect(skill.instructions).toBe("Do the review.");
  });

  it("throws on name mismatch", async () => {
    const manager = new SandboxManager(new InMemorySandboxProvider());
    const { sandboxId } = await manager.create({
      initialFiles: {
        "/skills/wrong-name/SKILL.md": skillMd("actual-name", "Desc", "Body"),
      },
    });
    const sandbox = await manager.getSandbox(sandboxId);
    const provider = new FileSystemSkillProvider(sandbox.fs, "/skills");

    await expect(provider.getSkill("wrong-name")).rejects.toThrow("mismatched name");
  });

  it("loadAll returns all skills with instructions", async () => {
    const manager = new SandboxManager(new InMemorySandboxProvider());
    const { sandboxId } = await manager.create({
      initialFiles: {
        "/skills/a/SKILL.md": skillMd("a", "Skill A", "A instructions"),
        "/skills/b/SKILL.md": skillMd("b", "Skill B", "B instructions"),
      },
    });
    const sandbox = await manager.getSandbox(sandboxId);
    const provider = new FileSystemSkillProvider(sandbox.fs, "/skills");
    const skills = await provider.loadAll();

    expect(skills).toHaveLength(2);
    expect(skills.find((s) => s.name === "a")?.instructions).toBe("A instructions");
    expect(skills.find((s) => s.name === "b")?.instructions).toBe("B instructions");
  });
});
