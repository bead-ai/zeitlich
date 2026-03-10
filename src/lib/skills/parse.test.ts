import { describe, expect, it } from "vitest";
import { parseSkillFile } from "./parse";

describe("parseSkillFile", () => {
  const minimal = `---
name: my-skill
description: A test skill
---
Body content here.`;

  it("parses minimal frontmatter and body", () => {
    const { frontmatter, body } = parseSkillFile(minimal);
    expect(frontmatter.name).toBe("my-skill");
    expect(frontmatter.description).toBe("A test skill");
    expect(body).toBe("Body content here.");
  });

  it("parses all optional fields", () => {
    const raw = `---
name: pdf-processing
description: Extract data from PDFs
license: MIT
compatibility: node>=18
allowed-tools: FileRead Bash Glob
metadata:
  author: test-user
  version: 1.0.0
---
# Instructions

Do the thing.`;

    const { frontmatter, body } = parseSkillFile(raw);
    expect(frontmatter.name).toBe("pdf-processing");
    expect(frontmatter.description).toBe("Extract data from PDFs");
    expect(frontmatter.license).toBe("MIT");
    expect(frontmatter.compatibility).toBe("node>=18");
    expect(frontmatter.allowedTools).toEqual(["FileRead", "Bash", "Glob"]);
    expect(frontmatter.metadata).toEqual({ author: "test-user", version: "1.0.0" });
    expect(body).toBe("# Instructions\n\nDo the thing.");
  });

  it("handles quoted values in frontmatter", () => {
    const raw = `---
name: "quoted-skill"
description: 'A quoted description'
---
Body`;

    const { frontmatter } = parseSkillFile(raw);
    expect(frontmatter.name).toBe("quoted-skill");
    expect(frontmatter.description).toBe("A quoted description");
  });

  it("strips BOM from input", () => {
    const raw = `\uFEFF---
name: bom-skill
description: Has BOM
---
Content`;

    const { frontmatter, body } = parseSkillFile(raw);
    expect(frontmatter.name).toBe("bom-skill");
    expect(body).toBe("Content");
  });

  it("throws when frontmatter is missing", () => {
    expect(() => parseSkillFile("No frontmatter here")).toThrow(
      "SKILL.md must start with YAML frontmatter delimited by ---"
    );
  });

  it("throws when name is missing", () => {
    const raw = `---
description: No name here
---
Body`;

    expect(() => parseSkillFile(raw)).toThrow(
      "SKILL.md frontmatter must include a 'name' field"
    );
  });

  it("throws when description is missing", () => {
    const raw = `---
name: no-desc
---
Body`;

    expect(() => parseSkillFile(raw)).toThrow(
      "SKILL.md frontmatter must include a 'description' field"
    );
  });

  it("handles CRLF line endings", () => {
    const raw = "---\r\nname: crlf-skill\r\ndescription: CRLF test\r\n---\r\nBody with CRLF";
    const { frontmatter, body } = parseSkillFile(raw);
    expect(frontmatter.name).toBe("crlf-skill");
    expect(body).toBe("Body with CRLF");
  });

  it("trims body whitespace", () => {
    const raw = `---
name: trim-skill
description: Trim test
---

  Indented body with surrounding whitespace

`;

    const { body } = parseSkillFile(raw);
    expect(body).toBe("Indented body with surrounding whitespace");
  });

  it("skips comment lines in YAML", () => {
    const raw = `---
# This is a comment
name: commented
description: Has comments
# Another comment
---
Body`;

    const { frontmatter } = parseSkillFile(raw);
    expect(frontmatter.name).toBe("commented");
    expect(frontmatter.description).toBe("Has comments");
  });

  it("ignores metadata when not an object", () => {
    const raw = `---
name: flat-meta
description: Flat metadata value
metadata: just-a-string
---
Body`;

    const { frontmatter } = parseSkillFile(raw);
    expect(frontmatter.metadata).toBeUndefined();
  });
});
