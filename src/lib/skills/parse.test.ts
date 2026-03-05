import { describe, expect, it } from "vitest";
import { parseSkillFile } from "./parse";

describe("parseSkillFile", () => {
  it("parses valid frontmatter with name and description", () => {
    const raw = `---
name: code-review
description: Reviews code for quality
---
## Instructions
Review the code carefully.`;

    const { frontmatter, body } = parseSkillFile(raw);
    expect(frontmatter.name).toBe("code-review");
    expect(frontmatter.description).toBe("Reviews code for quality");
    expect(body).toBe("## Instructions\nReview the code carefully.");
  });

  it("parses optional license and compatibility fields", () => {
    const raw = `---
name: pdf-processing
description: Processes PDFs
license: MIT
compatibility: linux-only
---
Body text`;

    const { frontmatter } = parseSkillFile(raw);
    expect(frontmatter.license).toBe("MIT");
    expect(frontmatter.compatibility).toBe("linux-only");
  });

  it("parses allowed-tools as space-delimited list", () => {
    const raw = `---
name: my-skill
description: A skill
allowed-tools: FileRead FileWrite Bash
---
Body`;

    const { frontmatter } = parseSkillFile(raw);
    expect(frontmatter.allowedTools).toEqual(["FileRead", "FileWrite", "Bash"]);
  });

  it("parses nested metadata map", () => {
    const raw = `---
name: my-skill
description: A skill
metadata:
  author: alice
  version: 1.0
---
Body`;

    const { frontmatter } = parseSkillFile(raw);
    expect(frontmatter.metadata).toEqual({ author: "alice", version: "1.0" });
  });

  it("handles quoted values", () => {
    const raw = `---
name: "my-skill"
description: 'A cool skill'
---
Body`;

    const { frontmatter } = parseSkillFile(raw);
    expect(frontmatter.name).toBe("my-skill");
    expect(frontmatter.description).toBe("A cool skill");
  });

  it("strips BOM from input", () => {
    const raw = `\uFEFF---
name: bom-skill
description: Has BOM
---
Body`;

    const { frontmatter } = parseSkillFile(raw);
    expect(frontmatter.name).toBe("bom-skill");
  });

  it("throws when frontmatter is missing", () => {
    expect(() => parseSkillFile("no frontmatter here")).toThrow(
      "SKILL.md must start with YAML frontmatter"
    );
  });

  it("throws when name is missing", () => {
    const raw = `---
description: No name
---
Body`;

    expect(() => parseSkillFile(raw)).toThrow("must include a 'name' field");
  });

  it("throws when description is missing", () => {
    const raw = `---
name: no-desc
---
Body`;

    expect(() => parseSkillFile(raw)).toThrow(
      "must include a 'description' field"
    );
  });

  it("trims body whitespace", () => {
    const raw = `---
name: trimmed
description: test
---

  Leading and trailing  

`;

    const { body } = parseSkillFile(raw);
    expect(body).toBe("Leading and trailing");
  });

  it("handles CRLF line endings", () => {
    const raw = "---\r\nname: crlf-skill\r\ndescription: CRLF test\r\n---\r\nBody text";

    const { frontmatter, body } = parseSkillFile(raw);
    expect(frontmatter.name).toBe("crlf-skill");
    expect(body).toBe("Body text");
  });

  it("ignores comment lines in YAML", () => {
    const raw = `---
# This is a comment
name: commented
description: Has comments
# Another comment
---
Body`;

    const { frontmatter } = parseSkillFile(raw);
    expect(frontmatter.name).toBe("commented");
  });

  it("handles empty body", () => {
    const raw = `---
name: empty-body
description: No body
---
`;

    const { body } = parseSkillFile(raw);
    expect(body).toBe("");
  });
});
