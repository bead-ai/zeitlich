import { describe, expect, it, vi } from "vitest";
import { readFileHandler } from "./handler";
import { VirtualFileSystem } from "../../lib/virtual-fs/filesystem";
import type { FileEntry, FileResolver } from "../../lib/virtual-fs/types";

interface TestCtx {
  projectId: string;
}

function createNoopResolver(): FileResolver<TestCtx> {
  return {
    resolveEntries: async () => [],
    readFile: vi.fn(async () => {
      throw new Error(
        "resolver.readFile should not be called for inline entries"
      );
    }),
    readFileBuffer: vi.fn(async () => {
      throw new Error(
        "resolver.readFileBuffer should not be called for inline entries"
      );
    }),
    writeFile: vi.fn(async () => {}),
    createFile: vi.fn(async () => {
      throw new Error("not implemented");
    }),
    deleteFile: vi.fn(async () => {}),
  };
}

const ctx: TestCtx = { projectId: "p" };

const skillEntry: FileEntry = {
  id: "skill:demo:notes.md",
  path: "/skills/demo/notes.md",
  size: 9,
  mtime: "2025-01-01T00:00:00.000Z",
  metadata: {},
  inlineContent: "# notes\n",
};

describe("readFileHandler — entry.inlineContent (skill resources)", () => {
  it("returns the inline content even when the resolver has no backing", async () => {
    const resolver = createNoopResolver();
    const fs = new VirtualFileSystem([skillEntry], resolver, ctx);

    const response = await readFileHandler(
      { path: "/skills/demo/notes.md" },
      {
        threadId: "t",
        toolCallId: "tc",
        toolName: "FileRead",
        // The handler signature requires SandboxContext, which expects a
        // SandboxFileSystem — VirtualFileSystem implements that interface.
        sandbox: { fs } as never,
        sandboxId: "ignored",
      }
    );

    expect(typeof response.toolResponse).toBe("string");
    expect(response.toolResponse).toContain("# notes");
    expect(response.data).not.toBeNull();
  });

  it("works with non-normalized agent-supplied paths (no leading slash)", async () => {
    const resolver = createNoopResolver();
    const fs = new VirtualFileSystem([skillEntry], resolver, ctx);

    const response = await readFileHandler(
      { path: "skills/demo/notes.md" },
      {
        threadId: "t",
        toolCallId: "tc",
        toolName: "FileRead",
        sandbox: { fs } as never,
        sandboxId: "ignored",
      }
    );

    expect(response.toolResponse).toContain("# notes");
    expect(response.data).not.toBeNull();
  });
});
