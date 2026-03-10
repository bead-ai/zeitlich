import { describe, expect, it } from "vitest";
import { toTree } from "./tree";
import type { SandboxFileSystem } from "./types";

function createMockFs(structure: Record<string, "file" | "dir" | "symlink">, symlinks: Record<string, string> = {}): SandboxFileSystem {
  return {
    readdirWithFileTypes: async (dir: string) => {
      const normalizedDir = dir.endsWith("/") ? dir : dir + "/";
      return Object.entries(structure)
        .filter(([path]) => {
          const parent = path.slice(0, path.lastIndexOf("/") + 1) || "/";
          return parent === normalizedDir;
        })
        .map(([path, type]) => ({
          name: path.slice(path.lastIndexOf("/") + 1),
          isDirectory: type === "dir",
          isFile: type === "file",
          isSymbolicLink: type === "symlink",
        }));
    },
    readlink: async (path: string) => symlinks[path] ?? "",
    exists: async () => true,
    readFile: async () => "",
    writeFile: async () => {},
    appendFile: async () => {},
    mkdir: async () => {},
    rm: async () => {},
    stat: async () => ({ isFile: true, isDirectory: false, isSymbolicLink: false, size: 0, lastModified: 0 }),
    readdir: async () => [],
    cp: async () => {},
    mv: async () => {},
  } as unknown as SandboxFileSystem;
}

describe("toTree", () => {
  it("renders a flat directory", async () => {
    const fs = createMockFs({
      "/a.txt": "file",
      "/b.txt": "file",
    });
    const tree = await toTree(fs);
    expect(tree).toContain("a.txt");
    expect(tree).toContain("b.txt");
    expect(tree).toContain("/");
  });

  it("renders nested directories", async () => {
    const fs = createMockFs({
      "/src": "dir",
      "/src/index.ts": "file",
      "/src/utils": "dir",
      "/src/utils/helpers.ts": "file",
      "/readme.md": "file",
    });
    const tree = await toTree(fs);
    expect(tree).toContain("src/");
    expect(tree).toContain("index.ts");
    expect(tree).toContain("utils/");
    expect(tree).toContain("helpers.ts");
    expect(tree).toContain("readme.md");
  });

  it("sorts directories before files by default", async () => {
    const fs = createMockFs({
      "/z-file.txt": "file",
      "/a-dir": "dir",
    });
    const tree = await toTree(fs);
    const dirIdx = tree.indexOf("a-dir/");
    const fileIdx = tree.indexOf("z-file.txt");
    expect(dirIdx).toBeLessThan(fileIdx);
  });

  it("respects depth limit", async () => {
    const fs = createMockFs({
      "/a": "dir",
      "/a/b": "dir",
      "/a/b/deep.txt": "file",
    });
    const tree = await toTree(fs, { depth: 1 });
    expect(tree).toContain("a/");
    expect(tree).toContain("(...)");
    expect(tree).not.toContain("deep.txt");
  });

  it("renders symlinks with arrow notation", async () => {
    const fs = createMockFs(
      { "/link": "symlink" },
      { "/link": "/target" }
    );
    const tree = await toTree(fs);
    expect(tree).toContain("link →");
    expect(tree).toContain("/target");
  });

  it("handles empty directory", async () => {
    const fs = createMockFs({});
    const tree = await toTree(fs);
    expect(tree).toContain("/");
  });
});
