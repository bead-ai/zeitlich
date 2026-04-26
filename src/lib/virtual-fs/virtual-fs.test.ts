import { describe, expect, it, beforeEach, vi } from "vitest";
import type { FileEntry, FileResolver } from "./types";
import { VirtualFileSystem } from "./filesystem";
import { applyVirtualTreeMutations } from "./mutations";
import { createVirtualFsActivities } from "./manager";
import { SandboxNotSupportedError } from "../sandbox/types";

// ============================================================================
// Mock resolver
// ============================================================================

interface TestCtx {
  projectId: string;
}

const seedContents: Record<string, string> = {
  "file-1": 'console.log("hello");',
  "file-2": "# README\nThis is a readme.",
  "file-3": "body { color: red; }",
};

function createMockResolver(): {
  resolver: FileResolver<TestCtx>;
  store: Map<string, string>;
} {
  const store = new Map(Object.entries(seedContents));
  let nextId = 100;

  const resolver: FileResolver<TestCtx> = {
    resolveEntries: async () =>
      [...store.keys()].map((id) => ({
        id,
        path: `/resolved/${id}.txt`,
        size: (store.get(id) ?? "").length,
        mtime: "2025-01-01T00:00:00.000Z",
        metadata: {},
      })),

    readFile: async (id) => {
      const content = store.get(id);
      if (content === undefined) throw new Error(`Not found: ${id}`);
      return content;
    },

    readFileBuffer: async (id) => {
      const content = store.get(id);
      if (content === undefined) throw new Error(`Not found: ${id}`);
      return new TextEncoder().encode(content);
    },

    writeFile: async (id, content) => {
      store.set(
        id,
        typeof content === "string"
          ? content
          : new TextDecoder().decode(content)
      );
    },

    createFile: async (path, content) => {
      const id = `new-${nextId++}`;
      store.set(
        id,
        typeof content === "string"
          ? content
          : new TextDecoder().decode(content)
      );
      const size =
        typeof content === "string"
          ? new TextEncoder().encode(content).byteLength
          : content.byteLength;
      return { id, path, size, mtime: new Date().toISOString(), metadata: {} };
    },

    deleteFile: async (id) => {
      store.delete(id);
    },
  };

  return { resolver, store };
}

// ============================================================================
// Fixtures
// ============================================================================

const sampleTree: FileEntry[] = [
  {
    id: "file-1",
    path: "/src/index.ts",
    size: 21,
    mtime: "2025-01-01T00:00:00.000Z",
    metadata: {},
  },
  {
    id: "file-2",
    path: "/README.md",
    size: 28,
    mtime: "2025-01-01T00:00:00.000Z",
    metadata: {},
  },
  {
    id: "file-3",
    path: "/src/styles/main.css",
    size: 21,
    mtime: "2025-01-01T00:00:00.000Z",
    metadata: {},
  },
];

const ctx: TestCtx = { projectId: "proj-42" };

// ============================================================================
// VirtualFileSystem
// ============================================================================

describe("VirtualFileSystem", () => {
  let fs: VirtualFileSystem<TestCtx>;

  beforeEach(() => {
    const { resolver } = createMockResolver();
    fs = new VirtualFileSystem(sampleTree, resolver, ctx);
  });

  // --- exists / stat ---

  it("exists returns true for files", async () => {
    expect(await fs.exists("/src/index.ts")).toBe(true);
  });

  it("exists returns true for inferred directories", async () => {
    expect(await fs.exists("/src")).toBe(true);
    expect(await fs.exists("/src/styles")).toBe(true);
    expect(await fs.exists("/")).toBe(true);
  });

  it("exists returns false for missing paths", async () => {
    expect(await fs.exists("/nope.txt")).toBe(false);
  });

  it("stat returns file metadata", async () => {
    const stat = await fs.stat("/src/index.ts");
    expect(stat.isFile).toBe(true);
    expect(stat.isDirectory).toBe(false);
    expect(stat.size).toBe(21);
  });

  it("stat returns directory metadata", async () => {
    const stat = await fs.stat("/src");
    expect(stat.isFile).toBe(false);
    expect(stat.isDirectory).toBe(true);
  });

  it("stat throws for missing path", async () => {
    await expect(fs.stat("/nope")).rejects.toThrow("ENOENT");
  });

  // --- readdir ---

  it("readdir lists root", async () => {
    const names = await fs.readdir("/");
    expect(names).toEqual(["README.md", "src"]);
  });

  it("readdir lists subdirectory", async () => {
    const names = await fs.readdir("/src");
    expect(names).toEqual(["index.ts", "styles"]);
  });

  it("readdir throws for missing directory", async () => {
    await expect(fs.readdir("/nonexistent")).rejects.toThrow("ENOENT");
  });

  it("readdirWithFileTypes returns correct types", async () => {
    const entries = await fs.readdirWithFileTypes("/src");
    const file = entries.find((e) => e.name === "index.ts");
    const dir = entries.find((e) => e.name === "styles");
    expect(file?.isFile).toBe(true);
    expect(file?.isDirectory).toBe(false);
    expect(dir?.isFile).toBe(false);
    expect(dir?.isDirectory).toBe(true);
  });

  // --- readFile ---

  it("readFile returns content from resolver", async () => {
    const content = await fs.readFile("/src/index.ts");
    expect(content).toBe('console.log("hello");');
  });

  it("readFile throws for missing file", async () => {
    await expect(fs.readFile("/missing.txt")).rejects.toThrow("ENOENT");
  });

  it("readFileBuffer returns Uint8Array", async () => {
    const buf = await fs.readFileBuffer("/README.md");
    expect(buf).toBeInstanceOf(Uint8Array);
    const text = new TextDecoder().decode(buf);
    expect(text).toBe("# README\nThis is a readme.");
  });

  // --- writeFile ---

  it("writeFile updates existing file", async () => {
    await fs.writeFile("/src/index.ts", "new content");
    const content = await fs.readFile("/src/index.ts");
    expect(content).toBe("new content");

    const [mutation] = fs.getMutations();
    expect(mutation?.type).toBe("update");
  });

  it("writeFile creates new file via resolver.createFile", async () => {
    await fs.writeFile("/src/new-file.ts", "brand new");
    expect(await fs.exists("/src/new-file.ts")).toBe(true);

    const [mutation] = fs.getMutations();
    expect(mutation?.type).toBe("add");
  });

  it("writeFile creates parent directories for new file", async () => {
    await fs.writeFile("/new/deep/file.ts", "deep");
    expect(await fs.exists("/new")).toBe(true);
    expect(await fs.exists("/new/deep")).toBe(true);
    expect(await fs.exists("/new/deep/file.ts")).toBe(true);
  });

  // --- appendFile ---

  it("appendFile appends to existing file", async () => {
    await fs.appendFile("/README.md", "\nAppended.");
    const content = await fs.readFile("/README.md");
    expect(content).toBe("# README\nThis is a readme.\nAppended.");

    const [mutation] = fs.getMutations();
    expect(mutation?.type).toBe("update");
  });

  it("appendFile creates file if missing", async () => {
    await fs.appendFile("/new-append.txt", "created");
    expect(await fs.exists("/new-append.txt")).toBe(true);

    const [mutation] = fs.getMutations();
    expect(mutation?.type).toBe("add");
  });

  // --- mkdir ---

  it("mkdir creates directory", async () => {
    await fs.mkdir("/newdir");
    expect(await fs.exists("/newdir")).toBe(true);
    const stat = await fs.stat("/newdir");
    expect(stat.isDirectory).toBe(true);
  });

  it("mkdir recursive creates nested directories", async () => {
    await fs.mkdir("/a/b/c", { recursive: true });
    expect(await fs.exists("/a")).toBe(true);
    expect(await fs.exists("/a/b")).toBe(true);
    expect(await fs.exists("/a/b/c")).toBe(true);
  });

  it("mkdir without recursive throws if parent missing", async () => {
    await expect(fs.mkdir("/missing/dir")).rejects.toThrow("ENOENT");
  });

  // --- rm ---

  it("rm removes a file", async () => {
    await fs.rm("/src/index.ts");
    expect(await fs.exists("/src/index.ts")).toBe(false);

    const [mutation] = fs.getMutations();
    expect(mutation?.type).toBe("remove");
  });

  it("rm recursive removes directory and contents", async () => {
    await fs.rm("/src", { recursive: true });
    expect(await fs.exists("/src")).toBe(false);
    expect(await fs.exists("/src/index.ts")).toBe(false);
    expect(await fs.exists("/src/styles/main.css")).toBe(false);
  });

  it("rm throws for directory without recursive", async () => {
    await expect(fs.rm("/src")).rejects.toThrow("EISDIR");
  });

  it("rm force does not throw for missing path", async () => {
    await expect(fs.rm("/nonexistent", { force: true })).resolves.not.toThrow();
  });

  // --- cp / mv ---

  it("cp copies a file", async () => {
    await fs.cp("/src/index.ts", "/src/copy.ts");
    const original = await fs.readFile("/src/index.ts");
    const copy = await fs.readFile("/src/copy.ts");
    expect(copy).toBe(original);
  });

  it("mv moves a file", async () => {
    await fs.mv("/src/index.ts", "/moved.ts");
    expect(await fs.exists("/src/index.ts")).toBe(false);
    expect(await fs.exists("/moved.ts")).toBe(true);
  });

  // --- resolvePath ---

  it("resolvePath resolves absolute path", () => {
    expect(fs.resolvePath("/src", "/absolute/path")).toBe("/absolute/path");
  });

  it("resolvePath resolves relative path", () => {
    expect(fs.resolvePath("/src", "file.ts")).toBe("/src/file.ts");
  });

  // --- readlink ---

  it("readlink throws SandboxNotSupportedError", async () => {
    await expect(fs.readlink("/src/index.ts")).rejects.toThrow(
      SandboxNotSupportedError
    );
  });
});

// ============================================================================
// VirtualFileSystem — inlineFiles
// ============================================================================

describe("VirtualFileSystem — inlineFiles", () => {
  const skillEntry: FileEntry = {
    id: "skill:code-review:checklist.md",
    path: "/skills/code-review/checklist.md",
    size: 18,
    mtime: "2025-01-01T00:00:00.000Z",
    metadata: {},
  };

  const inlineFiles: Record<string, string> = {
    "/skills/code-review/checklist.md": "# Review checklist",
  };

  function createFsWithInline() {
    const { resolver } = createMockResolver();
    return new VirtualFileSystem(
      [...sampleTree, skillEntry],
      resolver,
      ctx,
      "/",
      inlineFiles
    );
  }

  it("readFile returns inline content instead of hitting the resolver", async () => {
    const fs = createFsWithInline();
    const content = await fs.readFile("/skills/code-review/checklist.md");
    expect(content).toBe("# Review checklist");
  });

  it("readFileBuffer returns inline content as Uint8Array", async () => {
    const fs = createFsWithInline();
    const buf = await fs.readFileBuffer("/skills/code-review/checklist.md");
    expect(new TextDecoder().decode(buf)).toBe("# Review checklist");
  });

  it("inline files are visible in readdir", async () => {
    const fs = createFsWithInline();
    const names = await fs.readdir("/skills/code-review");
    expect(names).toContain("checklist.md");
  });

  it("inline file directories are inferred", async () => {
    const fs = createFsWithInline();
    expect(await fs.exists("/skills")).toBe(true);
    expect(await fs.exists("/skills/code-review")).toBe(true);
  });

  it("readFile still falls back to resolver for non-inline files", async () => {
    const fs = createFsWithInline();
    const content = await fs.readFile("/src/index.ts");
    expect(content).toBe('console.log("hello");');
  });

  it("readFile throws ENOENT for paths not in tree or inline", async () => {
    const fs = createFsWithInline();
    await expect(fs.readFile("/nope.txt")).rejects.toThrow("ENOENT");
  });
});

// ============================================================================
// VirtualFileSystem — entry.inlineContent
// ============================================================================

describe("VirtualFileSystem — entry.inlineContent", () => {
  const inlineEntry: FileEntry = {
    id: "skill:code-review:checklist.md",
    path: "/skills/code-review/checklist.md",
    size: 18,
    mtime: "2025-01-01T00:00:00.000Z",
    metadata: {},
    inlineContent: "# Review checklist",
  };

  function createFsWithInlineEntry(): VirtualFileSystem<TestCtx> {
    const { resolver } = createMockResolver();
    return new VirtualFileSystem([...sampleTree, inlineEntry], resolver, ctx);
  }

  it("readFile returns entry.inlineContent without hitting the resolver", async () => {
    const { resolver, store } = createMockResolver();
    const readFileSpy = vi.spyOn(resolver, "readFile");
    const fs = new VirtualFileSystem(
      [...sampleTree, inlineEntry],
      resolver,
      ctx
    );

    const content = await fs.readFile("/skills/code-review/checklist.md");
    expect(content).toBe("# Review checklist");
    expect(readFileSpy).not.toHaveBeenCalled();
    expect(store.size).toBeGreaterThan(0);
  });

  it("readFileBuffer returns entry.inlineContent encoded as Uint8Array", async () => {
    const fs = createFsWithInlineEntry();
    const buf = await fs.readFileBuffer("/skills/code-review/checklist.md");
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(buf)).toBe("# Review checklist");
  });

  it("entry.inlineContent files participate in directory inference", async () => {
    const fs = createFsWithInlineEntry();
    expect(await fs.exists("/skills")).toBe(true);
    expect(await fs.exists("/skills/code-review")).toBe(true);
    expect(await fs.readdir("/skills/code-review")).toContain("checklist.md");
  });

  it("inlineFiles map still wins over entry.inlineContent for the same path", async () => {
    const { resolver } = createMockResolver();
    const fs = new VirtualFileSystem(
      [...sampleTree, inlineEntry],
      resolver,
      ctx,
      "/",
      { "/skills/code-review/checklist.md": "OVERRIDE" }
    );
    expect(await fs.readFile("/skills/code-review/checklist.md")).toBe(
      "OVERRIDE"
    );
  });

  it("readFile resolves entry.inlineContent for non-normalized paths (no leading slash)", async () => {
    const fs = createFsWithInlineEntry();
    const content = await fs.readFile("skills/code-review/checklist.md");
    expect(content).toBe("# Review checklist");
  });

  it("empty-string entry.inlineContent is served without falling through to the resolver", async () => {
    const { resolver } = createMockResolver();
    const readFileSpy = vi.spyOn(resolver, "readFile");
    const fs = new VirtualFileSystem(
      [
        ...sampleTree,
        {
          id: "skill:empty",
          path: "/skills/empty.md",
          size: 0,
          mtime: "2025-01-01T00:00:00.000Z",
          metadata: {},
          inlineContent: "",
        } satisfies FileEntry,
      ],
      resolver,
      ctx
    );
    expect(await fs.readFile("/skills/empty.md")).toBe("");
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it("stat reports entry.inlineContent files as files", async () => {
    const fs = createFsWithInlineEntry();
    const stat = await fs.stat("/skills/code-review/checklist.md");
    expect(stat.isFile).toBe(true);
    expect(stat.isDirectory).toBe(false);
  });

  it("non-inline entries in the same tree still go through the resolver", async () => {
    const { resolver } = createMockResolver();
    const readFileSpy = vi.spyOn(resolver, "readFile");
    const fs = new VirtualFileSystem(
      [...sampleTree, inlineEntry],
      resolver,
      ctx
    );
    const content = await fs.readFile("/src/index.ts");
    expect(content).toBe('console.log("hello");');
    expect(readFileSpy).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// VirtualFileSystem — entry.inlineContent read-only contract
// ============================================================================

describe("VirtualFileSystem — entry.inlineContent read-only", () => {
  const inlineEntry: FileEntry = {
    id: "skill:demo:notes.md",
    path: "/skills/demo/notes.md",
    size: 8,
    mtime: "2025-01-01T00:00:00.000Z",
    metadata: {},
    inlineContent: "original",
  };

  function makeFs(): {
    fs: VirtualFileSystem<TestCtx>;
    resolver: FileResolver<TestCtx>;
    spies: {
      writeFile: ReturnType<typeof vi.spyOn>;
      deleteFile: ReturnType<typeof vi.spyOn>;
    };
  } {
    const { resolver } = createMockResolver();
    const writeFile = vi.spyOn(resolver, "writeFile");
    const deleteFile = vi.spyOn(resolver, "deleteFile");
    const fs = new VirtualFileSystem(
      [...sampleTree, inlineEntry],
      resolver,
      ctx
    );
    return { fs, resolver, spies: { writeFile, deleteFile } };
  }

  it("writeFile on inline entry throws EROFS and never calls resolver.writeFile", async () => {
    const { fs, spies } = makeFs();
    await expect(fs.writeFile("/skills/demo/notes.md", "new")).rejects.toThrow(
      /EROFS/
    );
    expect(spies.writeFile).not.toHaveBeenCalled();
  });

  it("appendFile on inline entry throws EROFS and never calls resolver.writeFile", async () => {
    const { fs, spies } = makeFs();
    await expect(
      fs.appendFile("/skills/demo/notes.md", "more")
    ).rejects.toThrow(/EROFS/);
    expect(spies.writeFile).not.toHaveBeenCalled();
  });

  it("rm on inline entry throws EROFS and never calls resolver.deleteFile", async () => {
    const { fs, spies } = makeFs();
    await expect(fs.rm("/skills/demo/notes.md")).rejects.toThrow(/EROFS/);
    expect(spies.deleteFile).not.toHaveBeenCalled();
  });

  it("rm recursive on a directory containing an inline entry throws EROFS", async () => {
    const { fs, spies } = makeFs();
    await expect(fs.rm("/skills", { recursive: true })).rejects.toThrow(
      /EROFS/
    );
    expect(spies.deleteFile).not.toHaveBeenCalled();
  });

  it("mv of an inline entry throws EROFS (rm step rejects after copy)", async () => {
    const { fs } = makeFs();
    await expect(fs.mv("/skills/demo/notes.md", "/copy.md")).rejects.toThrow(
      /EROFS/
    );
  });

  it("cp from inline source to a fresh destination uses inlineContent and creates via resolver", async () => {
    const { fs } = makeFs();
    await fs.cp("/skills/demo/notes.md", "/copied.md");
    expect(await fs.readFile("/copied.md")).toBe("original");
    expect(await fs.exists("/copied.md")).toBe(true);
  });

  it("appendFile to a missing path under an inline-only directory delegates to writeFile", async () => {
    const { fs } = makeFs();
    await fs.appendFile("/skills/demo/new.md", "hello");
    expect(await fs.readFile("/skills/demo/new.md")).toBe("hello");
  });

  it("cp over an inline destination throws EROFS", async () => {
    const { fs, spies } = makeFs();
    await expect(
      fs.cp("/src/index.ts", "/skills/demo/notes.md")
    ).rejects.toThrow(/EROFS/);
    expect(spies.writeFile).not.toHaveBeenCalled();
  });
});

// ============================================================================
// createVirtualFsActivities
// ============================================================================

describe("createVirtualFsActivities", () => {
  it("creates prefixed activity with resolveFileTree", async () => {
    const { resolver } = createMockResolver();
    const activities = createVirtualFsActivities(resolver, "codingAgent");

    expect(activities).toHaveProperty("virtualFsCodingAgentResolveFileTree");
    const result = await activities.virtualFsCodingAgentResolveFileTree(ctx);
    expect(result.fileTree).toHaveLength(3);
    expect(result.fileTree[0]?.path).toMatch(/^\/resolved\//);
  });
});

// ============================================================================
// applyVirtualTreeMutations
// ============================================================================

describe("applyVirtualTreeMutations", () => {
  function mockStateManager(tree: FileEntry[]): {
    get: (_key: "fileTree") => FileEntry[];
    set: (_key: "fileTree", value: FileEntry[]) => void;
    current: () => FileEntry[];
  } {
    let fileTree = tree;
    return {
      get: (_key: "fileTree"): FileEntry[] => fileTree,
      set: (_key: "fileTree", value: FileEntry[]): void => {
        fileTree = value;
      },
      current: (): FileEntry[] => fileTree,
    };
  }

  it("applies add mutation", () => {
    const sm = mockStateManager([...sampleTree]);
    const result = applyVirtualTreeMutations(sm, [
      {
        type: "add",
        entry: {
          id: "new-1",
          path: "/new.txt",
          size: 5,
          mtime: "2025-06-01T00:00:00.000Z",
          metadata: {},
        },
      },
    ]);
    expect(result).toHaveLength(sampleTree.length + 1);
    expect(result.find((e) => e.id === "new-1")).toBeTruthy();
    expect(sm.current()).toEqual(result);
  });

  it("applies remove mutation", () => {
    const sm = mockStateManager([...sampleTree]);
    const result = applyVirtualTreeMutations(sm, [
      { type: "remove", path: "/src/index.ts" },
    ]);
    expect(result).toHaveLength(sampleTree.length - 1);
    expect(result.find((e) => e.path === "/src/index.ts")).toBeUndefined();
    expect(sm.current()).toEqual(result);
  });

  it("applies update mutation", () => {
    const sm = mockStateManager([...sampleTree]);
    const result = applyVirtualTreeMutations(sm, [
      {
        type: "update",
        path: "/README.md",
        entry: { size: 999, mtime: "2025-12-01T00:00:00.000Z" },
      },
    ]);
    const updated = result.find((e) => e.path === "/README.md");
    expect(updated?.size).toBe(999);
    expect(updated?.id).toBe("file-2");
    expect(sm.current()).toEqual(result);
  });

  it("applies multiple mutations in order", () => {
    const sm = mockStateManager([...sampleTree]);
    const result = applyVirtualTreeMutations(sm, [
      { type: "remove", path: "/src/index.ts" },
      {
        type: "add",
        entry: {
          id: "replacement",
          path: "/src/index.ts",
          size: 10,
          mtime: "2025-06-01T00:00:00.000Z",
          metadata: {},
        },
      },
    ]);
    expect(result).toHaveLength(sampleTree.length);
    const entry = result.find((e) => e.path === "/src/index.ts");
    expect(entry?.id).toBe("replacement");
  });

  it("does not mutate the original array passed to the state manager", () => {
    const original = [...sampleTree];
    const sm = mockStateManager(sampleTree);
    applyVirtualTreeMutations(sm, [{ type: "remove", path: "/src/index.ts" }]);
    expect(sampleTree).toEqual(original);
  });
});
