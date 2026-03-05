import { describe, expect, it } from "vitest";
import { toTree } from "./fs";
import type { IFileSystem } from "just-bash";

interface DirEntry {
  name: string;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

function createMockFs(
  structure: Record<string, DirEntry[]>,
  links: Record<string, string> = {}
): IFileSystem {
  return {
    readdirWithFileTypes: async (dir: string) => {
      const normalized = dir.endsWith("/") ? dir : dir + "/";
      return structure[normalized] ?? [];
    },
    readlink: async (path: string) => links[path] ?? "",
  } as unknown as IFileSystem;
}

function dir(name: string): DirEntry {
  return { name, isDirectory: true, isSymbolicLink: false };
}

function file(name: string): DirEntry {
  return { name, isDirectory: false, isSymbolicLink: false };
}

function symlink(name: string): DirEntry {
  return { name, isDirectory: false, isSymbolicLink: true };
}

describe("toTree", () => {
  it("renders a flat directory", async () => {
    const fs = createMockFs({
      "/": [file("package.json"), file("README.md")],
    });

    const tree = await toTree(fs);
    expect(tree).toContain("/");
    expect(tree).toContain("package.json");
    expect(tree).toContain("README.md");
  });

  it("renders nested directories", async () => {
    const fs = createMockFs({
      "/": [dir("src"), file("package.json")],
      "/src/": [file("index.ts"), file("utils.ts")],
    });

    const tree = await toTree(fs);
    expect(tree).toContain("src/");
    expect(tree).toContain("index.ts");
    expect(tree).toContain("utils.ts");
    expect(tree).toContain("package.json");
  });

  it("sorts directories before files by default", async () => {
    const fs = createMockFs({
      "/": [file("b.ts"), dir("a-dir"), file("a.ts")],
    });

    const tree = await toTree(fs);
    const lines = tree.split("\n");
    const dirLine = lines.findIndex((l) => l.includes("a-dir/"));
    const fileLine = lines.findIndex((l) => l.includes("a.ts"));
    expect(dirLine).toBeLessThan(fileLine);
  });

  it("respects sort: false", async () => {
    const fs = createMockFs({
      "/": [file("z.ts"), file("a.ts")],
    });

    const tree = await toTree(fs, { sort: false });
    const lines = tree.split("\n");
    const zLine = lines.findIndex((l) => l.includes("z.ts"));
    const aLine = lines.findIndex((l) => l.includes("a.ts"));
    expect(zLine).toBeLessThan(aLine);
  });

  it("respects depth limit", async () => {
    const fs = createMockFs({
      "/": [dir("a")],
      "/a/": [dir("b")],
      "/a/b/": [file("deep.ts")],
    });

    const tree = await toTree(fs, { depth: 1 });
    expect(tree).toContain("a/");
    expect(tree).not.toContain("deep.ts");
  });

  it("shows (...) when depth is 0", async () => {
    const fs = createMockFs({
      "/": [file("test.ts")],
    });

    const tree = await toTree(fs, { depth: 0 });
    expect(tree).toContain("(...)");
    expect(tree).not.toContain("test.ts");
  });

  it("renders symlinks with arrow notation", async () => {
    const fs = createMockFs(
      { "/": [symlink("link.ts")] },
      { "/link.ts": "/real/path.ts" }
    );

    const tree = await toTree(fs);
    expect(tree).toContain("link.ts");
    expect(tree).toContain("→");
    expect(tree).toContain("/real/path.ts");
  });

  it("uses custom dir option", async () => {
    const fs = createMockFs({
      "/home/": [file("test.ts")],
    });

    const tree = await toTree(fs, { dir: "/home" });
    expect(tree).toContain("home/");
    expect(tree).toContain("test.ts");
  });

  it("handles empty directory", async () => {
    const fs = createMockFs({ "/": [] });

    const tree = await toTree(fs);
    expect(tree).toBe("/");
  });
});
