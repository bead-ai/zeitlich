import { dirname } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { createBashHandler } from "./handler";
import { OverlayFs } from "just-bash";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("bash with default options", () => {
  const fs = new OverlayFs({ root: __dirname, mountPoint: "/home/user" });

  it("executes echo and captures stdout", async () => {
    const { data } = await createBashHandler({fs})(
      { command: "echo 'hello world'" },
      {}
    );
    expect(data).not.toBeNull();
    expect(data?.stdout.trim()).toBe("hello world");
    expect(data?.exitCode).toBe(0);
  });

  it("returns exit code 0 for successful commands", async () => {
    const { data } = await createBashHandler({fs})({ command: "true" }, {});
    expect(data?.exitCode).toBe(0);
  });

  it("returns non-zero exit code for failed commands", async () => {
    const { data } = await createBashHandler({fs})({ command: "false" }, {});
    expect(data?.exitCode).toBe(1);
  });

  it("captures stderr output", async () => {
    const { data } = await createBashHandler({fs})(
      { command: "echo 'error message' >&2" },
      {}
    );
    expect(data?.stderr.trim()).toBe("error message");
    expect(data?.stdout.trim()).toBe("");
  });

  it("supports piping between commands", async () => {
    const { data } = await createBashHandler({fs})(
      { command: "echo 'hello world' | tr 'a-z' 'A-Z'" },
      {}
    );
    expect(data?.stdout.trim()).toBe("HELLO WORLD");
  });

  it("supports command chaining with &&", async () => {
    const { data } = await createBashHandler({fs})(
      { command: "echo 'first' && echo 'second'" },
      {}
    );
    expect(data?.stdout).toContain("first");
    expect(data?.stdout).toContain("second");
  });

  it("handles multi-line output", async () => {
    const { data } = await createBashHandler({fs})(
      { command: "printf 'line1\\nline2\\nline3'" },
      {}
    );
    const lines = data?.stdout.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines?.[0]).toBe("line1");
    expect(lines?.[2]).toBe("line3");
  });

  it("handles commands with arguments and flags", async () => {
    const { data } = await createBashHandler({fs})(
      { command: "echo -n 'no newline'" },
      {}
    );
    expect(data?.stdout).toBe("no newline");
  });

  it("supports command substitution", async () => {
    const { data } = await createBashHandler({fs})(
      { command: "echo \"count: $(echo 'a b c' | wc -w | tr -d ' ')\"" },
      {}
    );
    expect(data?.stdout.trim()).toBe("count: 3");
  });

  it("returns toolResponse string with formatted output", async () => {
    const { toolResponse } = await createBashHandler({fs})(
      { command: "echo 'test'" },
      {}
    );
    expect(toolResponse).toContain("Exit code: 0");
    expect(toolResponse).toContain("stdout:");
    expect(toolResponse).toContain("test");
  });
});

describe("bash with overlay filesystem", () => {
  it("sees files in the current directory", async () => {
    const fs = new OverlayFs({ root: __dirname, mountPoint: "/home/user" });
    const { data } = await createBashHandler({fs})({ command: "ls" }, {});
    expect(data?.stdout).toContain("bash.test.ts");
    expect(data?.stdout).toContain("handler.ts");
    expect(data?.stdout).toContain("tool.ts");
  });
});
