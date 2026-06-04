import { beforeEach, describe, expect, it } from "vitest";
import { InMemorySandboxProvider } from "../../test-utils/in-memory-sandbox";
import type { Sandbox, SandboxCreateOptions } from "../../lib/sandbox";
import { SandboxManager } from "../../lib/sandbox/manager";
import type { RouterContext } from "../../lib/tool-router/types";
import { withSandbox } from "../../lib/tool-router/with-sandbox";
import { applyEditPlan, editHandler, multiEditHandler } from "./handler";

describe("edit handlers", () => {
  let manager: SandboxManager<SandboxCreateOptions, Sandbox, "inMemory">;
  let sandboxId: string;

  const ctx = (id: string): RouterContext => ({
    sandboxId: id,
    threadId: "test-thread",
    toolCallId: "test-call",
    toolName: "FileEdit",
  });

  beforeEach(async () => {
    manager = new SandboxManager(new InMemorySandboxProvider());
    const result = await manager.create({
      initialFiles: {
        "/src/app.ts": [
          "export function greet(name: string) {",
          '  return "hello " + name;',
          "}",
          "",
          "export const status = 'draft';",
          "export const repeated = 'draft';",
          "",
        ].join("\n"),
      },
    });
    expect(result).not.toBeNull();
    sandboxId = (result as NonNullable<typeof result>).sandboxId;
  });

  it("applies one unique exact replacement", async () => {
    const handler = withSandbox(manager, editHandler);

    const response = await handler(
      {
        file_path: "/src/app.ts",
        old_string: '  return "hello " + name;',
        new_string: "  return `hello ${name}`;",
      },
      ctx(sandboxId)
    );

    const sandbox = await manager.getSandbox(sandboxId);
    await expect(sandbox.fs.readFile("/src/app.ts")).resolves.toContain(
      "return `hello ${name}`;"
    );
    expect(response.data?.success).toBe(true);
    expect(response.data?.replacements).toBe(1);
    expect(response.data?.hunks?.[0]).toMatchObject({
      oldStartLine: 2,
      newStartLine: 2,
      oldLines: ['  return "hello " + name;'],
      newLines: ["  return `hello ${name}`;"],
    });
  });

  it("refuses ambiguous single edits without replace_all", async () => {
    const handler = withSandbox(manager, editHandler);

    const response = await handler(
      {
        file_path: "/src/app.ts",
        old_string: "draft",
        new_string: "ready",
      },
      ctx(sandboxId)
    );

    const sandbox = await manager.getSandbox(sandboxId);
    await expect(sandbox.fs.readFile("/src/app.ts")).resolves.toContain(
      "status = 'draft'"
    );
    expect(response.data?.success).toBe(false);
    expect(response.toolResponse).toContain("appears 2 times");
  });

  it("supports replace_all for one edit", async () => {
    const handler = withSandbox(manager, editHandler);

    const response = await handler(
      {
        file_path: "/src/app.ts",
        old_string: "draft",
        new_string: "ready",
        replace_all: true,
      },
      ctx(sandboxId)
    );

    const sandbox = await manager.getSandbox(sandboxId);
    const content = await sandbox.fs.readFile("/src/app.ts");
    expect(content).toContain("status = 'ready'");
    expect(content).toContain("repeated = 'ready'");
    expect(response.data?.success).toBe(true);
    expect(response.data?.replacements).toBe(2);
  });

  it("applies multiple edits sequentially and atomically", async () => {
    const handler = withSandbox(manager, multiEditHandler);

    const response = await handler(
      {
        file_path: "/src/app.ts",
        edits: [
          {
            old_string: '  return "hello " + name;',
            new_string: "  return `hello ${name}`;",
          },
          { old_string: "draft", new_string: "ready", replace_all: true },
        ],
      },
      { ...ctx(sandboxId), toolName: "FileMultiEdit" }
    );

    const sandbox = await manager.getSandbox(sandboxId);
    const content = await sandbox.fs.readFile("/src/app.ts");
    expect(content).toContain("return `hello ${name}`;");
    expect(content).toContain("status = 'ready'");
    expect(content).toContain("repeated = 'ready'");
    expect(response.data?.success).toBe(true);
    expect(response.data?.replacements).toBe(3);
    expect(response.data?.hunks).toHaveLength(3);
  });

  it("leaves the file unchanged when a later multi-edit fails", async () => {
    const handler = withSandbox(manager, multiEditHandler);
    const sandbox = await manager.getSandbox(sandboxId);
    const before = await sandbox.fs.readFile("/src/app.ts");

    const response = await handler(
      {
        file_path: "/src/app.ts",
        edits: [
          {
            old_string: '  return "hello " + name;',
            new_string: "  return `hello ${name}`;",
          },
          { old_string: "missing text", new_string: "replacement" },
        ],
      },
      { ...ctx(sandboxId), toolName: "FileMultiEdit" }
    );

    await expect(sandbox.fs.readFile("/src/app.ts")).resolves.toBe(before);
    expect(response.data?.success).toBe(false);
    expect(response.toolResponse).toContain("edit 1");
  });
});

describe("applyEditPlan", () => {
  it("rejects empty old_string before mutating content", () => {
    const result = applyEditPlan("abc", [{ old_string: "", new_string: "x" }]);

    expect(result).toMatchObject({ ok: false, editIndex: 0 });
  });

  it("treats replacement text literally", () => {
    const result = applyEditPlan("a.$^ b.$^", [
      { old_string: ".$^", new_string: "literal" },
    ]);

    expect(result).toMatchObject({ ok: false });

    const unique = applyEditPlan("a.$^", [
      { old_string: ".$^", new_string: "literal" },
    ]);
    expect(unique).toMatchObject({ ok: true, content: "aliteral" });
  });
});
