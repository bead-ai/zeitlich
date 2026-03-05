import { describe, expect, it } from "vitest";
import { createReadSkillHandler } from "./handler";
import type { Skill } from "../../lib/skills/types";

const skills: Skill[] = [
  {
    name: "code-review",
    description: "Reviews code",
    instructions: "## Step 1\nReview carefully.",
  },
  {
    name: "testing",
    description: "Writes tests",
    instructions: "Write unit tests for all modules.",
  },
];

describe("createReadSkillHandler", () => {
  const handler = createReadSkillHandler(skills);

  it("returns instructions for a known skill", () => {
    const { toolResponse, data } = handler({ skill_name: "code-review" });

    expect(toolResponse).toBe("## Step 1\nReview carefully.");
    expect(data).toBeNull();
  });

  it("returns instructions for another known skill", () => {
    const { toolResponse } = handler({ skill_name: "testing" });

    expect(toolResponse).toBe("Write unit tests for all modules.");
  });

  it("returns error for unknown skill", () => {
    const { toolResponse, data } = handler({ skill_name: "nonexistent" });

    expect(toolResponse).toContain("not found");
    expect(data).toBeNull();
  });
});
