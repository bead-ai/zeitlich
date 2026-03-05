import { describe, expect, it } from "vitest";
import { createEditHandler } from "./handler";
import { OverlayFs } from "just-bash";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeFs() {
  return new OverlayFs({ root: __dirname, mountPoint: "/workspace" });
}

describe("createEditHandler", () => {
  it("replaces a unique occurrence", async () => {
    const fs = makeFs();
    await fs.writeFile("/workspace/test.txt", "hello world");

    const handler = createEditHandler(fs);
    const { data, toolResponse } = await handler(
      {
        file_path: "/workspace/test.txt",
        old_string: "hello",
        new_string: "goodbye",
      },
      {}
    );

    expect(data.success).toBe(true);
    expect(data.replacements).toBe(1);
    expect(toolResponse).toContain("Replaced 1 occurrence");

    const content = await fs.readFile("/workspace/test.txt");
    expect(content).toBe("goodbye world");
  });

  it("replaces all occurrences with replace_all", async () => {
    const fs = makeFs();
    await fs.writeFile("/workspace/test.txt", "aaa bbb aaa bbb aaa");

    const handler = createEditHandler(fs);
    const { data } = await handler(
      {
        file_path: "/workspace/test.txt",
        old_string: "aaa",
        new_string: "ccc",
        replace_all: true,
      },
      {}
    );

    expect(data.success).toBe(true);
    expect(data.replacements).toBe(3);

    const content = await fs.readFile("/workspace/test.txt");
    expect(content).toBe("ccc bbb ccc bbb ccc");
  });

  it("errors when old_string equals new_string", async () => {
    const fs = makeFs();
    await fs.writeFile("/workspace/test.txt", "hello");

    const handler = createEditHandler(fs);
    const { data } = await handler(
      {
        file_path: "/workspace/test.txt",
        old_string: "hello",
        new_string: "hello",
      },
      {}
    );

    expect(data.success).toBe(false);
  });

  it("errors when file does not exist", async () => {
    const fs = makeFs();

    const handler = createEditHandler(fs);
    const { data, toolResponse } = await handler(
      {
        file_path: "/workspace/nonexistent.txt",
        old_string: "a",
        new_string: "b",
      },
      {}
    );

    expect(data.success).toBe(false);
    expect(toolResponse).toContain("does not exist");
  });

  it("errors when old_string is not found", async () => {
    const fs = makeFs();
    await fs.writeFile("/workspace/test.txt", "hello world");

    const handler = createEditHandler(fs);
    const { data, toolResponse } = await handler(
      {
        file_path: "/workspace/test.txt",
        old_string: "missing text",
        new_string: "replacement",
      },
      {}
    );

    expect(data.success).toBe(false);
    expect(toolResponse).toContain("Could not find");
  });

  it("errors on ambiguous match without replace_all", async () => {
    const fs = makeFs();
    await fs.writeFile("/workspace/test.txt", "foo bar foo");

    const handler = createEditHandler(fs);
    const { data, toolResponse } = await handler(
      {
        file_path: "/workspace/test.txt",
        old_string: "foo",
        new_string: "baz",
      },
      {}
    );

    expect(data.success).toBe(false);
    expect(toolResponse).toContain("appears 2 times");
  });

  it("handles special regex characters in old_string", async () => {
    const fs = makeFs();
    await fs.writeFile("/workspace/test.txt", "price is $100.00 (USD)");

    const handler = createEditHandler(fs);
    const { data } = await handler(
      {
        file_path: "/workspace/test.txt",
        old_string: "$100.00 (USD)",
        new_string: "€90.00 (EUR)",
      },
      {}
    );

    expect(data.success).toBe(true);

    const content = await fs.readFile("/workspace/test.txt");
    expect(content).toBe("price is €90.00 (EUR)");
  });

  it("preserves surrounding content", async () => {
    const fs = makeFs();
    await fs.writeFile("/workspace/test.txt", "line1\nreplace_me\nline3");

    const handler = createEditHandler(fs);
    await handler(
      {
        file_path: "/workspace/test.txt",
        old_string: "replace_me",
        new_string: "replaced",
      },
      {}
    );

    const content = await fs.readFile("/workspace/test.txt");
    expect(content).toBe("line1\nreplaced\nline3");
  });
});
