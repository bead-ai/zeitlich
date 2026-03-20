import { describe, expect, it, vi } from "vitest";
import { parseSkillFile } from "./parse";
import { createReadSkillTool } from "./tool";
import { createReadSkillHandler } from "./handler";
import { buildSkillRegistration } from "./register";
import { FileSystemSkillProvider } from "./fs-provider";
import type { Skill } from "./types";
import type { SandboxFileSystem, DirentEntry } from "../sandbox/types";

// ---------------------------------------------------------------------------
// parseSkillFile
// ---------------------------------------------------------------------------

describe("parseSkillFile", () => {
  it("parses a minimal SKILL.md with name and description", () => {
    const raw = `---
name: my-skill
description: Does useful things
---
# Instructions
Do the thing.`;

    const { frontmatter, body } = parseSkillFile(raw);

    expect(frontmatter.name).toBe("my-skill");
    expect(frontmatter.description).toBe("Does useful things");
    expect(body).toBe("# Instructions\nDo the thing.");
  });

  it("parses full frontmatter with all optional fields", () => {
    const raw = `---
name: advanced-skill
description: A more complex skill
license: MIT
compatibility: linux-only
allowed-tools: bash grep read-file
metadata:
  author: test-author
  version: 1.0
---
Body content here.`;

    const { frontmatter, body } = parseSkillFile(raw);

    expect(frontmatter.name).toBe("advanced-skill");
    expect(frontmatter.description).toBe("A more complex skill");
    expect(frontmatter.license).toBe("MIT");
    expect(frontmatter.compatibility).toBe("linux-only");
    expect(frontmatter.allowedTools).toEqual(["bash", "grep", "read-file"]);
    expect(frontmatter.metadata).toEqual({ author: "test-author", version: "1.0" });
    expect(body).toBe("Body content here.");
  });

  it("strips BOM from input", () => {
    const raw = `\uFEFF---
name: bom-skill
description: Has BOM
---
Content`;

    const { frontmatter } = parseSkillFile(raw);
    expect(frontmatter.name).toBe("bom-skill");
  });

  it("handles quoted values in frontmatter", () => {
    const raw = `---
name: "quoted-skill"
description: 'single quoted description'
---
Body`;

    const { frontmatter } = parseSkillFile(raw);
    expect(frontmatter.name).toBe("quoted-skill");
    expect(frontmatter.description).toBe("single quoted description");
  });

  it("throws when frontmatter is missing", () => {
    expect(() => parseSkillFile("No frontmatter here")).toThrow(
      "SKILL.md must start with YAML frontmatter",
    );
  });

  it("throws when name is missing", () => {
    const raw = `---
description: Missing name
---
Body`;

    expect(() => parseSkillFile(raw)).toThrow(
      "SKILL.md frontmatter must include a 'name' field",
    );
  });

  it("throws when description is missing", () => {
    const raw = `---
name: no-desc
---
Body`;

    expect(() => parseSkillFile(raw)).toThrow(
      "SKILL.md frontmatter must include a 'description' field",
    );
  });

  it("handles empty body", () => {
    const raw = `---
name: empty-body
description: No body content
---
`;

    const { body } = parseSkillFile(raw);
    expect(body).toBe("");
  });

  it("handles CRLF line endings", () => {
    const raw = "---\r\nname: crlf-skill\r\ndescription: CRLF test\r\n---\r\nBody with CRLF";

    const { frontmatter, body } = parseSkillFile(raw);
    expect(frontmatter.name).toBe("crlf-skill");
    expect(body).toBe("Body with CRLF");
  });

  it("ignores comment lines in frontmatter", () => {
    const raw = `---
name: commented
# This is a comment
description: Has comments
---
Body`;

    const { frontmatter } = parseSkillFile(raw);
    expect(frontmatter.name).toBe("commented");
    expect(frontmatter.description).toBe("Has comments");
  });

  it("handles metadata with empty map (key with no value)", () => {
    const raw = `---
name: meta-skill
description: Has metadata section
metadata:
  key1: value1
  key2: value2
---
Body`;

    const { frontmatter } = parseSkillFile(raw);
    expect(frontmatter.metadata).toEqual({ key1: "value1", key2: "value2" });
  });

  it("trims body whitespace", () => {
    const raw = `---
name: trimmed
description: Trims body
---

  
  Body with leading whitespace
  And trailing
  `;

    const { body } = parseSkillFile(raw);
    expect(body).toBe("Body with leading whitespace\n  And trailing");
  });
});

// ---------------------------------------------------------------------------
// createReadSkillTool
// ---------------------------------------------------------------------------

describe("createReadSkillTool", () => {
  const skills: Skill[] = [
    {
      name: "skill-a",
      description: "First skill",
      instructions: "Do A",
    },
    {
      name: "skill-b",
      description: "Second skill",
      instructions: "Do B",
    },
  ];

  it("creates a tool with correct name and dynamic schema", () => {
    const tool = createReadSkillTool(skills);

    expect(tool.name).toBe("ReadSkill");
    expect(tool.description).toContain("skill-a");
    expect(tool.description).toContain("skill-b");
    expect(tool.description).toContain("First skill");
    expect(tool.description).toContain("Second skill");
  });

  it("schema validates skill_name enum", () => {
    const tool = createReadSkillTool(skills);

    const validResult = tool.schema.safeParse({ skill_name: "skill-a" });
    expect(validResult.success).toBe(true);

    const invalidResult = tool.schema.safeParse({ skill_name: "nonexistent" });
    expect(invalidResult.success).toBe(false);
  });

  it("throws when no skills are provided", () => {
    expect(() => createReadSkillTool([])).toThrow(
      "createReadSkillTool requires at least one skill",
    );
  });
});

// ---------------------------------------------------------------------------
// createReadSkillHandler — structured wrapping
// ---------------------------------------------------------------------------

describe("createReadSkillHandler", () => {
  it("wraps instructions in <skill_content> tags", () => {
    const skills: Skill[] = [
      { name: "skill-a", description: "First", instructions: "Do the thing." },
    ];
    const handler = createReadSkillHandler(skills);
    const result = handler({ skill_name: "skill-a" });

    const text = result.toolResponse as string;
    expect(text).toContain('<skill_content name="skill-a">');
    expect(text).toContain("Do the thing.");
    expect(text).toContain("</skill_content>");
    expect(result.data).toBeNull();
  });

  it("includes skill directory when location is set", () => {
    const skills: Skill[] = [
      {
        name: "skill-a",
        description: "First",
        instructions: "Do A",
        location: "/skills/skill-a",
      },
    ];
    const handler = createReadSkillHandler(skills);
    const result = handler({ skill_name: "skill-a" });

    const text = result.toolResponse as string;
    expect(text).toContain("Skill directory: /skills/skill-a");
    expect(text).toContain("Relative paths in this skill resolve against the skill directory above.");
  });

  it("lists resources derived from resourceContents keys", () => {
    const skills: Skill[] = [
      {
        name: "skill-a",
        description: "First",
        instructions: "Do A",
        location: "/skills/skill-a",
        resourceContents: {
          "references/overview.md": "# Overview",
          "scripts/extract.py": "print('hi')",
        },
      },
    ];
    const handler = createReadSkillHandler(skills);
    const result = handler({ skill_name: "skill-a" });

    const text = result.toolResponse as string;
    expect(text).toContain("<skill_resources>");
    expect(text).toContain("<file>references/overview.md</file>");
    expect(text).toContain("<file>scripts/extract.py</file>");
    expect(text).toContain("</skill_resources>");
  });

  it("omits resources block when skill has no resourceContents", () => {
    const skills: Skill[] = [
      { name: "skill-a", description: "First", instructions: "Do A" },
    ];
    const handler = createReadSkillHandler(skills);
    const result = handler({ skill_name: "skill-a" });

    const text = result.toolResponse as string;
    expect(text).not.toContain("<skill_resources>");
  });

  it("omits location line when location is not set", () => {
    const skills: Skill[] = [
      { name: "skill-a", description: "First", instructions: "Do A" },
    ];
    const handler = createReadSkillHandler(skills);
    const result = handler({ skill_name: "skill-a" });

    const text = result.toolResponse as string;
    expect(text).not.toContain("Skill directory:");
  });

  it("returns error for unknown skill name", () => {
    const skills: Skill[] = [
      { name: "skill-a", description: "First", instructions: "Do A" },
    ];
    const handler = createReadSkillHandler(skills);
    const result = handler({ skill_name: "nonexistent" });

    expect(typeof result.toolResponse).toBe("string");
    expect((result.toolResponse as string)).toContain("not found");
    expect(result.data).toBeNull();
  });

  it("handles single skill", () => {
    const skills: Skill[] = [
      { name: "skill-a", description: "First", instructions: "Instructions for A" },
    ];
    const handler = createReadSkillHandler(skills);
    const result = handler({ skill_name: "skill-a" });
    expect((result.toolResponse as string)).toContain("Instructions for A");
  });
});

// ---------------------------------------------------------------------------
// createReadSkillHandler — resourceContents
// ---------------------------------------------------------------------------

describe("createReadSkillHandler with resourceContents", () => {
  it("does not leak resourceContents into the tool response", () => {
    const skills: Skill[] = [
      {
        name: "skill-a",
        description: "First",
        instructions: "Do A",
        location: "/skills/skill-a",
        resourceContents: { "references/overview.md": "# Overview content" },
      },
    ];
    const handler = createReadSkillHandler(skills);
    const result = handler({ skill_name: "skill-a" });

    const text = result.toolResponse as string;
    expect(text).toContain("<file>references/overview.md</file>");
    expect(text).not.toContain("# Overview content");
  });
});

// ---------------------------------------------------------------------------
// buildSkillRegistration
// ---------------------------------------------------------------------------

describe("buildSkillRegistration", () => {
  it("returns null for empty skills array", () => {
    expect(buildSkillRegistration([])).toBeNull();
  });

  it("throws on duplicate skill names", () => {
    const skills: Skill[] = [
      { name: "dupe", description: "First", instructions: "A" },
      { name: "dupe", description: "Second", instructions: "B" },
    ];
    expect(() => buildSkillRegistration(skills)).toThrow("Duplicate skill names: dupe");
  });

  it("returns a complete tool entry with handler", () => {
    const skills: Skill[] = [
      {
        name: "my-skill",
        description: "My skill",
        instructions: "Do things",
      },
    ];

    const registration = buildSkillRegistration(skills);

    expect(registration).not.toBeNull();
    expect(registration).toBeDefined();
    if (registration) {
      expect(registration.name).toBe("ReadSkill");
      expect(registration.handler).toBeDefined();
      expect(typeof registration.handler).toBe("function");
    }
  });

  it("registered handler returns structured wrapping end-to-end", () => {
    const skills: Skill[] = [
      {
        name: "test-skill",
        description: "Test",
        instructions: "Test instructions content",
        location: "/skills/test-skill",
        resourceContents: { "references/guide.md": "# Guide" },
      },
    ];

    const registration = buildSkillRegistration(skills);
    expect(registration).toBeDefined();
    if (!registration) return;
    const result = registration.handler(
      { skill_name: "test-skill" },
      { threadId: "t-1", toolCallId: "tc-1", toolName: "ReadSkill" },
    );

    if (result instanceof Promise) {
      return result.then((r) => {
        const text = r.toolResponse as string;
        expect(text).toContain('<skill_content name="test-skill">');
        expect(text).toContain("Test instructions content");
        expect(text).toContain("Skill directory: /skills/test-skill");
        expect(text).toContain("<file>references/guide.md</file>");
      });
    }
    const text = result.toolResponse as string;
    expect(text).toContain('<skill_content name="test-skill">');
    expect(text).toContain("Test instructions content");
    expect(text).toContain("Skill directory: /skills/test-skill");
    expect(text).toContain("<file>references/guide.md</file>");
    return;
  });
});

// ---------------------------------------------------------------------------
// FileSystemSkillProvider — resource discovery
// ---------------------------------------------------------------------------

function createMockFs(
  tree: Record<string, string | "DIR">,
): SandboxFileSystem {
  const dir = (entries: DirentEntry[]): DirentEntry[] => entries;

  return {
    workspaceBase: "/",
    readFile: vi.fn(async (path: string) => {
      const val = tree[path];
      if (val === undefined || val === "DIR")
        throw new Error(`ENOENT: ${path}`);
      return val;
    }),
    exists: vi.fn(async (path: string) => path in tree),
    readdirWithFileTypes: vi.fn(async (path: string) => {
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const seen = new Set<string>();
      const entries: DirentEntry[] = [];
      for (const key of Object.keys(tree)) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const parts = rest.split("/");
        const name = parts[0] ?? "";
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const isDir = parts.length > 1 || tree[key] === "DIR";
        entries.push({
          name,
          isFile: !isDir,
          isDirectory: isDir,
          isSymbolicLink: false,
        });
      }
      return dir(entries);
    }),
    readFileBuffer: vi.fn(),
    writeFile: vi.fn(),
    appendFile: vi.fn(),
    stat: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
    rm: vi.fn(),
    cp: vi.fn(),
    mv: vi.fn(),
    readlink: vi.fn(),
    resolvePath: vi.fn(),
  };
}

describe("FileSystemSkillProvider", () => {
  const skillMd = `---
name: my-skill
description: A test skill
---
Do the thing.`;

  it("discovers resources in arbitrary subdirectories", async () => {
    const fs = createMockFs({
      "/skills/my-skill/SKILL.md": skillMd,
      "/skills/my-skill/templates/prompt.txt": "prompt content",
      "/skills/my-skill/templates": "DIR",
      "/skills/my-skill/data/config.json": '{"key":"value"}',
      "/skills/my-skill/data": "DIR",
      "/skills/my-skill": "DIR",
    });

    const provider = new FileSystemSkillProvider(fs, "/skills");
    const skills = await provider.loadAll();

    expect(skills).toHaveLength(1);
    const [skill] = skills;
    expect(skill?.resourceContents).toEqual({
      "templates/prompt.txt": "prompt content",
      "data/config.json": '{"key":"value"}',
    });
  });

  it("discovers deeply nested resources", async () => {
    const fs = createMockFs({
      "/skills/my-skill/SKILL.md": skillMd,
      "/skills/my-skill/references": "DIR",
      "/skills/my-skill/references/deep": "DIR",
      "/skills/my-skill/references/deep/nested.md": "nested content",
      "/skills/my-skill": "DIR",
    });

    const provider = new FileSystemSkillProvider(fs, "/skills");
    const skills = await provider.loadAll();

    expect(skills).toHaveLength(1);
    expect(skills[0]?.resourceContents).toEqual({
      "references/deep/nested.md": "nested content",
    });
  });

  it("excludes SKILL.md from resource contents", async () => {
    const fs = createMockFs({
      "/skills/my-skill/SKILL.md": skillMd,
      "/skills/my-skill/readme.txt": "readme",
      "/skills/my-skill": "DIR",
    });

    const provider = new FileSystemSkillProvider(fs, "/skills");
    const skills = await provider.loadAll();

    expect(skills).toHaveLength(1);
    expect(skills[0]?.resourceContents).toEqual({
      "readme.txt": "readme",
    });
  });

  it("returns undefined resourceContents when no resources exist", async () => {
    const fs = createMockFs({
      "/skills/my-skill/SKILL.md": skillMd,
      "/skills/my-skill": "DIR",
    });

    const provider = new FileSystemSkillProvider(fs, "/skills");
    const skills = await provider.loadAll();

    expect(skills).toHaveLength(1);
    expect(skills[0]?.resourceContents).toBeUndefined();
  });

  it("getSkill loads resources from arbitrary directories", async () => {
    const fs = createMockFs({
      "/skills/my-skill/SKILL.md": skillMd,
      "/skills/my-skill/custom-dir": "DIR",
      "/skills/my-skill/custom-dir/file.txt": "custom content",
      "/skills/my-skill": "DIR",
    });

    const provider = new FileSystemSkillProvider(fs, "/skills");
    const skill = await provider.getSkill("my-skill");

    expect(skill.resourceContents).toEqual({
      "custom-dir/file.txt": "custom content",
    });
  });

  it("ignores hidden files and directories", async () => {
    const fs = createMockFs({
      "/skills/my-skill/SKILL.md": skillMd,
      "/skills/my-skill/.git": "DIR",
      "/skills/my-skill/.git/config": "git config",
      "/skills/my-skill/.DS_Store": "binary",
      "/skills/my-skill/data": "DIR",
      "/skills/my-skill/data/file.txt": "visible",
      "/skills/my-skill": "DIR",
    });

    const provider = new FileSystemSkillProvider(fs, "/skills");
    const skills = await provider.loadAll();

    expect(skills).toHaveLength(1);
    expect(skills[0]?.resourceContents).toEqual({
      "data/file.txt": "visible",
    });
  });

  it("listSkills does not load resourceContents", async () => {
    const fs = createMockFs({
      "/skills/my-skill/SKILL.md": skillMd,
      "/skills/my-skill/data/file.txt": "data",
      "/skills/my-skill/data": "DIR",
      "/skills/my-skill": "DIR",
    });

    const provider = new FileSystemSkillProvider(fs, "/skills");
    const metadata = await provider.listSkills();

    expect(metadata).toHaveLength(1);
    expect(metadata[0]?.name).toBe("my-skill");
    expect((metadata[0] as Skill).resourceContents).toBeUndefined();
  });
});
