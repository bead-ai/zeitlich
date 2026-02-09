import { dirname } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { handleBashTool } from "./handler";
import path from "path";
import dotenv from "dotenv";
import { Sandbox } from "e2b";

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, "./.env") });

describe.sequential("bash with default options", () => {
  let sandboxId: string;
  let apiKey: string;

  beforeAll(async () => {
    const E2B_API_KEY = process.env.E2B_API_KEY;
    if (!E2B_API_KEY) {
      throw new Error("E2B_API_KEY is not set in environment variables");
    }

    apiKey = E2B_API_KEY;
    const sandbox = await Sandbox.create({ apiKey });
    sandboxId = sandbox.sandboxId;
    
    console.log(`Created sandbox with ID: ${sandboxId}`);
  });

  afterAll(async () => {
    if (sandboxId) {
      const sandbox = await Sandbox.connect(sandboxId);
      await sandbox.kill();
      console.log(`Killed sandbox with ID: ${sandboxId}`);
    }
  });
  it("executes echo and captures stdout", async () => {
    const { result } = await handleBashTool(sandboxId, apiKey)(
      { command: "echo 'hello world'" },
      {}
    );
    expect(result).not.toBeNull();
    expect(result?.stdout.trim()).toBe("hello world");
    expect(result?.exitCode).toBe(0);
  });

  it("returns exit code 0 for successful commands", async () => {
    const { result } = await handleBashTool(sandboxId, apiKey)({ command: "true" }, {});
    expect(result?.exitCode).toBe(0);
  });

  it("captures stderr output", async () => {
    const { result } = await handleBashTool(sandboxId, apiKey)(
      { command: "echo 'error message' >&2" },
      {}
    );
    expect(result?.stderr.trim()).toBe("error message");
    expect(result?.stdout.trim()).toBe("");
  });

  it("supports piping between commands", async () => {
    const { result } = await handleBashTool(sandboxId, apiKey)(
      { command: "echo 'hello world' | tr 'a-z' 'A-Z'" },
      {}
    );
    expect(result?.stdout.trim()).toBe("HELLO WORLD");
  });

  it("supports command chaining with &&", async () => {
    const { result } = await handleBashTool(sandboxId, apiKey)(
      { command: "echo 'first' && echo 'second'" },
      {}
    );
    expect(result?.stdout).toContain("first");
    expect(result?.stdout).toContain("second");
  });

  it("handles multi-line output", async () => {
    const { result } = await handleBashTool(sandboxId, apiKey)(
      { command: "printf 'line1\\nline2\\nline3'" },
      {}
    );
    const lines = result?.stdout.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines?.[0]).toBe("line1");
    expect(lines?.[2]).toBe("line3");
  });

  it("handles commands with arguments and flags", async () => {
    const { result } = await handleBashTool(sandboxId, apiKey)(
      { command: "echo -n 'no newline'" },
      {}
    );
    expect(result?.stdout).toBe("no newline");
  });

  it("supports command substitution", async () => {
    const { result } = await handleBashTool(sandboxId, apiKey)(
      { command: "echo \"count: $(echo 'a b c' | wc -w | tr -d ' ')\"" },
      {}
    );
    expect(result?.stdout.trim()).toBe("count: 3");
  });

  it("returns content string with formatted output", async () => {
    const { content } = await handleBashTool(sandboxId, apiKey)(
      { command: "echo 'test'" },
      {}
    );
    expect(content).toContain("Exit code: 0");
    expect(content).toContain("stdout:");
    expect(content).toContain("test");
  });
});