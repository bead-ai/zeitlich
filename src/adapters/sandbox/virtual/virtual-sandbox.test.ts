import { beforeEach, describe, expect, it } from "vitest";
import { SandboxNotSupportedError } from "../../../lib/sandbox/types";
import { VirtualSandboxFileSystem } from "./filesystem";
import { createVirtualSandbox } from "./index";
import { applyVirtualTreeMutations } from "./mutations";
import { VirtualSandboxProvider } from "./provider";
import type { FileEntry, FileResolver } from "./types";

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
          : new TextDecoder().decode(content),
      );
    },

    createFile: async (path, content) => {
      const id = `new-${nextId++}`;
      store.set(
        id,
        typeof content === "string"
          ? content
          : new TextDecoder().decode(content),
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
// VirtualSandboxFileSystem
// ============================================================================

describe("VirtualSandboxFileSystem", () => {
  let fs: VirtualSandboxFileSystem<TestCtx>;

  beforeEach(() => {
    const { resolver } = createMockResolver();
    fs = new VirtualSandboxFileSystem(sampleTree, resolver, ctx);
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
      SandboxNotSupportedError,
    );
  });
});

// ============================================================================
// createVirtualSandbox
// ============================================================================

describe("createVirtualSandbox", () => {
  it("creates a sandbox with correct capabilities", () => {
    const { resolver } = createMockResolver();
    const sandbox = createVirtualSandbox("test-id", sampleTree, resolver, ctx);
    expect(sandbox.capabilities.filesystem).toBe(true);
    expect(sandbox.capabilities.execution).toBe(false);
    expect(sandbox.capabilities.persistence).toBe(true);
  });

  it("exec throws SandboxNotSupportedError", async () => {
    const { resolver } = createMockResolver();
    const sandbox = createVirtualSandbox("test-id", sampleTree, resolver, ctx);
    await expect(sandbox.exec("ls")).rejects.toThrow(SandboxNotSupportedError);
  });

  it("fs operations work through the sandbox", async () => {
    const { resolver } = createMockResolver();
    const sandbox = createVirtualSandbox("test-id", sampleTree, resolver, ctx);
    const content = await sandbox.fs.readFile("/README.md");
    expect(content).toBe("# README\nThis is a readme.");
  });

  it("getMutations is accessible", async () => {
    const { resolver } = createMockResolver();
    const sandbox = createVirtualSandbox("test-id", sampleTree, resolver, ctx);
    await sandbox.fs.writeFile("/new.txt", "hi");
    expect(sandbox.fs.getMutations()).toHaveLength(1);
  });
});

// ============================================================================
// VirtualSandboxProvider
// ============================================================================

describe("VirtualSandboxProvider", () => {
  it("create resolves entries and returns sandbox + stateUpdate", async () => {
    const { resolver } = createMockResolver();
    const provider = new VirtualSandboxProvider(resolver);
    const { sandbox, stateUpdate } = await provider.create({
      resolverContext: ctx,
    });
    expect(sandbox.capabilities.filesystem).toBe(true);
    expect(sandbox.capabilities.execution).toBe(false);
    const content = await sandbox.fs.readFile("/resolved/file-1.txt");
    expect(content).toBe('console.log("hello");');

    expect(stateUpdate).toBeDefined();
    expect(stateUpdate?.resolverContext).toEqual(ctx);
    expect(Array.isArray(stateUpdate?.fileTree)).toBe(true);
    expect((stateUpdate?.fileTree as FileEntry[]).length).toBe(3);
  });

  it("create uses provided id as sandbox id", async () => {
    const { resolver } = createMockResolver();
    const provider = new VirtualSandboxProvider(resolver);
    const { sandbox, stateUpdate } = await provider.create({
      id: "my-sandbox",
      resolverContext: ctx,
    });
    expect(sandbox.id).toBe("my-sandbox");
    expect(stateUpdate?.sandboxId).toBe("my-sandbox");
  });

  it("get throws (state lives in workflow)", async () => {
    const { resolver } = createMockResolver();
    const provider = new VirtualSandboxProvider(resolver);
    await expect(provider.get()).rejects.toThrow("Sandbox does not support");
  });

  it("snapshot throws (state lives in workflow)", async () => {
    const { resolver } = createMockResolver();
    const provider = new VirtualSandboxProvider(resolver);
    await expect(provider.snapshot()).rejects.toThrow(
      "Sandbox does not support",
    );
  });

  it("restore throws (state lives in workflow)", async () => {
    const { resolver } = createMockResolver();
    const provider = new VirtualSandboxProvider(resolver);
    await expect(provider.restore()).rejects.toThrow(
      "Sandbox does not support",
    );
  });

  it("destroy is a no-op", async () => {
    const { resolver } = createMockResolver();
    const provider = new VirtualSandboxProvider(resolver);
    await expect(provider.destroy()).resolves.not.toThrow();
  });

  it("create throws without required options", async () => {
    const { resolver } = createMockResolver();
    const provider = new VirtualSandboxProvider(resolver);
    await expect(provider.create()).rejects.toThrow("requires resolverContext");
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
