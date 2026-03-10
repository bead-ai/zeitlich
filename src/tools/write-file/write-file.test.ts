import { describe, expect, it, beforeEach } from "vitest";
import { writeFileHandler } from "./handler";
import { withSandbox } from "../../lib/tool-router/with-sandbox";
import { SandboxManager } from "../../lib/sandbox/manager";
import { InMemorySandboxProvider } from "../../adapters/sandbox/inmemory/index";
import type { RouterContext } from "../../lib/tool-router/types";

describe("write-file handler with sandbox", () => {
  let manager: SandboxManager;
  let sandboxId: string;
  let handler: ReturnType<typeof withSandbox<Parameters<typeof writeFileHandler>[0], Awaited<ReturnType<typeof writeFileHandler>>["data"]>>;

  beforeEach(async () => {
    manager = new SandboxManager(new InMemorySandboxProvider());
    const result = await manager.create({
      initialFiles: { "/existing.txt": "old content" },
    });
    sandboxId = result.sandboxId;
    handler = withSandbox(manager, writeFileHandler);
  });

  const ctx = (id: string): RouterContext => ({
    sandboxId: id,
    threadId: "test-thread",
    toolCallId: "test-call",
    toolName: "FileWrite",
  });

  it("writes a new file", async () => {
    const { data, toolResponse } = await handler(
      { file_path: "/new-file.txt", content: "hello world" },
      ctx(sandboxId)
    );
    expect(data?.success).toBe(true);
    expect(toolResponse).toContain("Successfully wrote");

    const sandbox = await manager.getSandbox(sandboxId);
    const content = await sandbox.fs.readFile("/new-file.txt");
    expect(content).toBe("hello world");
  });

  it("overwrites an existing file", async () => {
    const { data } = await handler(
      { file_path: "/existing.txt", content: "new content" },
      ctx(sandboxId)
    );
    expect(data?.success).toBe(true);

    const sandbox = await manager.getSandbox(sandboxId);
    const content = await sandbox.fs.readFile("/existing.txt");
    expect(content).toBe("new content");
  });

  it("creates intermediate directories", async () => {
    const { data } = await handler(
      { file_path: "/deep/nested/dir/file.txt", content: "deep content" },
      ctx(sandboxId)
    );
    expect(data?.success).toBe(true);

    const sandbox = await manager.getSandbox(sandboxId);
    const content = await sandbox.fs.readFile("/deep/nested/dir/file.txt");
    expect(content).toBe("deep content");
  });

  it("returns error when no sandboxId in context", async () => {
    const { toolResponse, data } = await handler(
      { file_path: "/test.txt", content: "data" },
      { threadId: "t", toolCallId: "c", toolName: "FileWrite" }
    );
    expect(toolResponse).toContain("No sandbox configured");
    expect(data).toBeNull();
  });
});
