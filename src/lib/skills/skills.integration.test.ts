import { describe, expect, it } from "vitest";
import { parseSkillFile } from "./parse";
import { createReadSkillTool } from "./tool";
import { createReadSkillHandler } from "./handler";
import { buildSkillRegistration } from "./register";
import type { Skill } from "./types";

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
// createReadSkillHandler
// ---------------------------------------------------------------------------

describe("createReadSkillHandler", () => {
  const skills: Skill[] = [
    {
      name: "skill-a",
      description: "First skill",
      instructions: "Instructions for A",
    },
    {
      name: "skill-b",
      description: "Second skill",
      instructions: "Instructions for B",
    },
  ];

  it("returns skill instructions for a valid skill name", () => {
    const handler = createReadSkillHandler(skills);
    const result = handler({ skill_name: "skill-a" });

    expect(result.toolResponse).toBe("Instructions for A");
    expect(result.data).toBeNull();
  });

  it("returns error for unknown skill name", () => {
    const handler = createReadSkillHandler(skills);
    const result = handler({ skill_name: "nonexistent" });

    expect(typeof result.toolResponse).toBe("string");
    expect((result.toolResponse as string)).toContain("not found");
    expect(result.data).toBeNull();
  });

  it("handles single skill", () => {
    const firstSkill = skills[0];
    if (!firstSkill) throw new Error("expected skill");
    const handler = createReadSkillHandler([firstSkill]);
    const result = handler({ skill_name: "skill-a" });
    expect(result.toolResponse).toBe("Instructions for A");
  });
});

// ---------------------------------------------------------------------------
// buildSkillRegistration
// ---------------------------------------------------------------------------

describe("buildSkillRegistration", () => {
  it("returns null for empty skills array", () => {
    expect(buildSkillRegistration([])).toBeNull();
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

  it("registered handler works end-to-end", () => {
    const skills: Skill[] = [
      {
        name: "test-skill",
        description: "Test",
        instructions: "Test instructions content",
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
        expect(r.toolResponse).toBe("Test instructions content");
      });
    }
    expect(result.toolResponse).toBe("Test instructions content");
    return;
  });
});
