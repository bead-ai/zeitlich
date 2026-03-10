import { describe, expect, it, beforeEach } from "vitest";
import { globHandler } from "./handler";
import { withSandbox } from "../../lib/tool-router/with-sandbox";
import { SandboxManager } from "../../lib/sandbox/manager";
import { InMemorySandboxProvider } from "../../adapters/sandbox/inmemory/index";
import type { RouterContext } from "../../lib/tool-router/types";

describe("glob handler with sandbox", () => {
  let manager: SandboxManager;
  let sandboxId: string;
  let handler: ReturnType<typeof withSandbox<Parameters<typeof globHandler>[0], Awaited<ReturnType<typeof globHandler>>["data"]>>;

  beforeEach(async () => {
    manager = new SandboxManager(new InMemorySandboxProvider());
    const result = await manager.create({
      initialFiles: {
        "/src/index.ts": "export {};",
        "/src/utils.ts": "export {};",
        "/src/components/button.tsx": "<button/>",
        "/docs/readme.md": "# Docs",
        "/package.json": "{}",
      },
    });
    sandboxId = result.sandboxId;
    handler = withSandbox(manager, globHandler);
  });

  const ctx = (id: string): RouterContext => ({
    sandboxId: id,
    threadId: "test-thread",
    toolCallId: "test-call",
    toolName: "Glob",
  });

  it("finds all .ts files recursively", async () => {
    const { data } = await handler({ pattern: "**/*.ts" }, ctx(sandboxId));
    expect(data?.files).toContain("src/index.ts");
    expect(data?.files).toContain("src/utils.ts");
    expect(data?.files).not.toContain("src/components/button.tsx");
  });

  it("finds files with .tsx extension", async () => {
    const { data } = await handler({ pattern: "**/*.tsx" }, ctx(sandboxId));
    expect(data?.files).toContain("src/components/button.tsx");
    expect(data?.files).toHaveLength(1);
  });

  it("finds files in a specific directory", async () => {
    const { data } = await handler({ pattern: "*.md", root: "/docs" }, ctx(sandboxId));
    expect(data?.files).toContain("readme.md");
  });

  it("returns empty when no match", async () => {
    const { data, toolResponse } = await handler({ pattern: "**/*.py" }, ctx(sandboxId));
    expect(data?.files).toHaveLength(0);
    expect(toolResponse).toContain("No files matched");
  });

  it("finds root-level files", async () => {
    const { data } = await handler({ pattern: "package.json" }, ctx(sandboxId));
    expect(data?.files).toContain("package.json");
  });

  it("returns error when no sandboxId in context", async () => {
    const { toolResponse, data } = await handler(
      { pattern: "**/*" },
      { threadId: "t", toolCallId: "c", toolName: "Glob" }
    );
    expect(toolResponse).toContain("No sandbox configured");
    expect(data).toBeNull();
  });
});
