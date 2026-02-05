import { dirname } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { handleBashTool } from "./handler";
import { OverlayFs } from "just-bash";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("bash with default options", () => {
  const fs = new OverlayFs({ root: __dirname, mountPoint: "/home/user" });

  it("executes echo and captures stdout", async () => {
    const { result } = await handleBashTool(fs)(
      { command: "echo 'hello world'" },
      {}
    );
    expect(result).not.toBeNull();
    expect(result?.stdout.trim()).toBe("hello world");
    expect(result?.exitCode).toBe(0);
  });

  it("returns exit code 0 for successful commands", async () => {
    const { result } = await handleBashTool(fs)({ command: "true" }, {});
    expect(result?.exitCode).toBe(0);
  });

  it("returns non-zero exit code for failed commands", async () => {
    const { result } = await handleBashTool(fs)({ command: "false" }, {});
    expect(result?.exitCode).toBe(1);
  });

  it("captures stderr output", async () => {
    const { result } = await handleBashTool(fs)(
      { command: "echo 'error message' >&2" },
      {}
    );
    expect(result?.stderr.trim()).toBe("error message");
    expect(result?.stdout.trim()).toBe("");
  });

  it("supports piping between commands", async () => {
    const { result } = await handleBashTool(fs)(
      { command: "echo 'hello world' | tr 'a-z' 'A-Z'" },
      {}
    );
    expect(result?.stdout.trim()).toBe("HELLO WORLD");
  });

  it("supports command chaining with &&", async () => {
    const { result } = await handleBashTool(fs)(
      { command: "echo 'first' && echo 'second'" },
      {}
    );
    expect(result?.stdout).toContain("first");
    expect(result?.stdout).toContain("second");
  });

  it("handles multi-line output", async () => {
    const { result } = await handleBashTool(fs)(
      { command: "printf 'line1\\nline2\\nline3'" },
      {}
    );
    const lines = result?.stdout.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines?.[0]).toBe("line1");
    expect(lines?.[2]).toBe("line3");
  });

  it("handles commands with arguments and flags", async () => {
    const { result } = await handleBashTool(fs)(
      { command: "echo -n 'no newline'" },
      {}
    );
    expect(result?.stdout).toBe("no newline");
  });

  it("supports command substitution", async () => {
    const { result } = await handleBashTool(fs)(
      { command: "echo \"count: $(echo 'a b c' | wc -w | tr -d ' ')\"" },
      {}
    );
    expect(result?.stdout.trim()).toBe("count: 3");
  });

  it("returns content string with formatted output", async () => {
    const { content } = await handleBashTool(fs)(
      { command: "echo 'test'" },
      {}
    );
    expect(content).toContain("Exit code: 0");
    expect(content).toContain("stdout:");
    expect(content).toContain("test");
  });
});

describe("bash with overlay filesystem", () => {
  it("sees files in the current directory", async () => {
    const fs = new OverlayFs({ root: __dirname, mountPoint: "/home/user" });
    const { result } = await handleBashTool(fs)({ command: "ls" }, {});
    expect(result?.stdout).toContain("bash.test.ts");
    expect(result?.stdout).toContain("handler.ts");
    expect(result?.stdout).toContain("tool.ts");
  });
});
