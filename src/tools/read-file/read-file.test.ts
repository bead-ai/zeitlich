import { describe, expect, it, beforeEach } from "vitest";
import { readFileHandler } from "./handler";
import { withSandbox } from "../../lib/tool-router/with-sandbox";
import { SandboxManager } from "../../lib/sandbox/manager";
import { InMemorySandboxProvider } from "../../adapters/sandbox/inmemory/index";
import type { RouterContext } from "../../lib/tool-router/types";

describe("read-file handler with sandbox", () => {
  let manager: SandboxManager;
  let sandboxId: string;
  let handler: ReturnType<typeof withSandbox<Parameters<typeof readFileHandler>[0], Awaited<ReturnType<typeof readFileHandler>>["data"]>>;

  const fileContent = "line one\nline two\nline three\nline four\nline five";

  beforeEach(async () => {
    manager = new SandboxManager(new InMemorySandboxProvider());
    const result = await manager.create({
      initialFiles: {
        "/src/main.ts": fileContent,
        "/empty.txt": "",
      },
    });
    sandboxId = result.sandboxId;
    handler = withSandbox(manager, readFileHandler);
  });

  const ctx = (id: string): RouterContext => ({
    sandboxId: id,
    threadId: "test-thread",
    toolCallId: "test-call",
    toolName: "FileRead",
  });

  it("reads an entire file with line numbers", async () => {
    const { data, toolResponse } = await handler(
      { path: "/src/main.ts" },
      ctx(sandboxId)
    );
    expect(data).not.toBeNull();
    expect(data?.totalLines).toBe(5);
    expect(toolResponse).toContain("line one");
    expect(toolResponse).toContain("line five");
    expect(data?.content).toMatch(/^\s*1\|line one/);
  });

  it("reads a slice with offset and limit", async () => {
    const { data } = await handler(
      { path: "/src/main.ts", offset: 2, limit: 2 },
      ctx(sandboxId)
    );
    expect(data).not.toBeNull();
    expect(data?.content).toContain("line two");
    expect(data?.content).toContain("line three");
    expect(data?.content).not.toContain("line one");
    expect(data?.content).not.toContain("line four");
  });

  it("handles offset only (reads to end)", async () => {
    const { data } = await handler(
      { path: "/src/main.ts", offset: 4 },
      ctx(sandboxId)
    );
    expect(data).not.toBeNull();
    expect(data?.content).toContain("line four");
    expect(data?.content).toContain("line five");
    expect(data?.content).not.toContain("line one");
  });

  it("returns error for nonexistent file", async () => {
    const { data, toolResponse } = await handler(
      { path: "/no-such-file.ts" },
      ctx(sandboxId)
    );
    expect(data).toBeNull();
    expect(toolResponse).toContain("does not exist");
  });

  it("reads an empty file", async () => {
    const { data } = await handler(
      { path: "/empty.txt" },
      ctx(sandboxId)
    );
    expect(data).not.toBeNull();
    expect(data?.totalLines).toBe(1);
  });

  it("returns error when no sandboxId in context", async () => {
    const { toolResponse, data } = await handler(
      { path: "/src/main.ts" },
      { threadId: "t", toolCallId: "c", toolName: "FileRead" }
    );
    expect(toolResponse).toContain("No sandbox configured");
    expect(data).toBeNull();
  });
});
