import { describe, expect, it } from "vitest";
import { toTree } from "./tree";
import type { DirentEntry, SandboxFileSystem } from "./types";

function createMockFs(
  structure: Record<
    string,
    { isDir: boolean; isLink?: boolean; linkTarget?: string }
  >,
): SandboxFileSystem {
  return {
    workspaceBase: "/",
    exists: async (path: string) => path in structure,
    stat: async (path: string) => {
      const entry = structure[path];
      return {
        isFile: entry ? !entry.isDir : false,
        isDirectory: entry ? entry.isDir : false,
        isSymbolicLink: entry?.isLink ?? false,
        size: 0,
        mtime: new Date(),
      };
    },
    readdir: async (dir: string) => {
      const prefix = dir.endsWith("/") ? dir : `${dir}/`;
      return Object.keys(structure)
        .filter(
          (p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"),
        )
        .map((p) => p.slice(prefix.length));
    },
    readdirWithFileTypes: async (dir: string): Promise<DirentEntry[]> => {
      const prefix = dir.endsWith("/") ? dir : `${dir}/`;
      return Object.entries(structure)
        .filter(
          ([p]) =>
            p.startsWith(prefix) && !p.slice(prefix.length).includes("/"),
        )
        .map(([p, meta]) => ({
          name: p.slice(prefix.length),
          isFile: !meta.isDir && !meta.isLink,
          isDirectory: meta.isDir,
          isSymbolicLink: meta.isLink ?? false,
        }));
    },
    readFile: async () => "",
    readFileBuffer: async () => new Uint8Array(),
    writeFile: async () => {},
    appendFile: async () => {},
    mkdir: async () => {},
    rm: async () => {},
    cp: async () => {},
    mv: async () => {},
    readlink: async (path: string) => structure[path]?.linkTarget ?? "",
    resolvePath: (base: string, path: string) => `${base}/${path}`,
  };
}

describe("toTree", () => {
  it("renders a flat directory", async () => {
    const fs = createMockFs({
      "/a.txt": { isDir: false },
      "/b.txt": { isDir: false },
      "/c.txt": { isDir: false },
    });

    const tree = await toTree(fs);
    expect(tree).toContain("a.txt");
    expect(tree).toContain("b.txt");
    expect(tree).toContain("c.txt");
    expect(tree).toContain("├─");
    expect(tree).toContain("└─");
  });

  it("renders nested directories", async () => {
    const fs = createMockFs({
      "/src": { isDir: true },
      "/src/index.ts": { isDir: false },
      "/src/utils.ts": { isDir: false },
      "/package.json": { isDir: false },
    });

    const tree = await toTree(fs);
    expect(tree).toContain("src/");
    expect(tree).toContain("index.ts");
    expect(tree).toContain("utils.ts");
    expect(tree).toContain("package.json");
  });

  it("sorts directories before files", async () => {
    const fs = createMockFs({
      "/zebra.txt": { isDir: false },
      "/alpha": { isDir: true },
      "/beta.txt": { isDir: false },
    });

    const tree = await toTree(fs);
    const lines = tree.split("\n");
    const alphaLine = lines.findIndex((l) => l.includes("alpha/"));
    const zebraLine = lines.findIndex((l) => l.includes("zebra.txt"));
    expect(alphaLine).toBeLessThan(zebraLine);
  });

  it("renders symlinks with target", async () => {
    const fs = createMockFs({
      "/link.txt": { isDir: false, isLink: true, linkTarget: "/real.txt" },
      "/real.txt": { isDir: false },
    });

    const tree = await toTree(fs);
    expect(tree).toContain("link.txt");
    expect(tree).toContain("→");
    expect(tree).toContain("/real.txt");
  });

  it("respects depth limit", async () => {
    const fs = createMockFs({
      "/a": { isDir: true },
      "/a/b": { isDir: true },
      "/a/b/c.txt": { isDir: false },
    });

    const shallowTree = await toTree(fs, { depth: 1 });
    expect(shallowTree).toContain("a/");
    expect(shallowTree).toContain("(...)");
    expect(shallowTree).not.toContain("c.txt");

    const deepTree = await toTree(fs, { depth: 3 });
    expect(deepTree).toContain("a/");
    expect(deepTree).toContain("b/");
    expect(deepTree).toContain("c.txt");
  });

  it("renders empty directory", async () => {
    const fs = createMockFs({});

    const tree = await toTree(fs);
    expect(tree).toContain("/");
  });

  it("disables sorting when sort=false", async () => {
    const fs = createMockFs({
      "/z.txt": { isDir: false },
      "/a.txt": { isDir: false },
    });

    const tree = await toTree(fs, { sort: false });
    expect(tree).toContain("z.txt");
    expect(tree).toContain("a.txt");
  });

  it("uses custom start directory", async () => {
    const fs = createMockFs({
      "/home/user/file.txt": { isDir: false },
    });

    const tree = await toTree(fs, { dir: "/home/user" });
    expect(tree).toContain("user/");
    expect(tree).toContain("file.txt");
  });
});
