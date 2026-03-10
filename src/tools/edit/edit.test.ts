import { describe, expect, it, beforeEach } from "vitest";
import { editHandler } from "./handler";
import { withSandbox } from "../../lib/tool-router/with-sandbox";
import { SandboxManager } from "../../lib/sandbox/manager";
import { InMemorySandboxProvider } from "../../adapters/sandbox/inmemory/index";
import type { RouterContext } from "../../lib/tool-router/types";

describe("edit handler with sandbox", () => {
  let manager: SandboxManager;
  let sandboxId: string;
  let handler: ReturnType<typeof withSandbox<Parameters<typeof editHandler>[0], Awaited<ReturnType<typeof editHandler>>["data"]>>;

  beforeEach(async () => {
    manager = new SandboxManager(new InMemorySandboxProvider());
    const result = await manager.create({
      initialFiles: {
        "/src/index.ts": 'const greeting = "hello";\nconsole.log(greeting);\n',
        "/readme.md": "# Title\n\nSome content\n\nSome content\n",
      },
    });
    sandboxId = result.sandboxId;
    handler = withSandbox(manager, editHandler);
  });

  const ctx = (id: string): RouterContext => ({
    sandboxId: id,
    threadId: "test-thread",
    toolCallId: "test-call",
    toolName: "FileEdit",
  });

  it("replaces a unique string", async () => {
    const { data, toolResponse } = await handler(
      { file_path: "/src/index.ts", old_string: '"hello"', new_string: '"world"' },
      ctx(sandboxId)
    );
    expect(data?.success).toBe(true);
    expect(data?.replacements).toBe(1);
    expect(toolResponse).toContain("Replaced 1 occurrence");

    const sandbox = await manager.getSandbox(sandboxId);
    const content = await sandbox.fs.readFile("/src/index.ts");
    expect(content).toContain('"world"');
  });

  it("errors when old_string equals new_string", async () => {
    const { data, toolResponse } = await handler(
      { file_path: "/src/index.ts", old_string: "hello", new_string: "hello" },
      ctx(sandboxId)
    );
    expect(data?.success).toBe(false);
    expect(toolResponse).toContain("must be different");
  });

  it("errors when file does not exist", async () => {
    const { data, toolResponse } = await handler(
      { file_path: "/nonexistent.ts", old_string: "a", new_string: "b" },
      ctx(sandboxId)
    );
    expect(data?.success).toBe(false);
    expect(toolResponse).toContain("does not exist");
  });

  it("errors when old_string is not found", async () => {
    const { data, toolResponse } = await handler(
      { file_path: "/src/index.ts", old_string: "not found text", new_string: "x" },
      ctx(sandboxId)
    );
    expect(data?.success).toBe(false);
    expect(toolResponse).toContain("Could not find");
  });

  it("errors when old_string has multiple occurrences without replace_all", async () => {
    const { data, toolResponse } = await handler(
      { file_path: "/readme.md", old_string: "Some content", new_string: "New content" },
      ctx(sandboxId)
    );
    expect(data?.success).toBe(false);
    expect(toolResponse).toContain("appears 2 times");
  });

  it("replaces all occurrences with replace_all: true", async () => {
    const { data, toolResponse } = await handler(
      { file_path: "/readme.md", old_string: "Some content", new_string: "New content", replace_all: true },
      ctx(sandboxId)
    );
    expect(data?.success).toBe(true);
    expect(data?.replacements).toBe(2);
    expect(toolResponse).toContain("Replaced 2 occurrence(s)");

    const sandbox = await manager.getSandbox(sandboxId);
    const content = await sandbox.fs.readFile("/readme.md");
    expect(content).not.toContain("Some content");
    expect(content.match(/New content/g)?.length).toBe(2);
  });

  it("returns error when no sandboxId in context", async () => {
    const { toolResponse, data } = await handler(
      { file_path: "/src/index.ts", old_string: "a", new_string: "b" },
      { threadId: "t", toolCallId: "c", toolName: "FileEdit" }
    );
    expect(toolResponse).toContain("No sandbox configured");
    expect(data).toBeNull();
  });
});
