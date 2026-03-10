import { describe, expect, it } from "vitest";
import { formatVirtualFileTree } from "./tree";
import type { FileEntry } from "./types";

const entry = (path: string): FileEntry => ({
  id: path,
  path,
  size: 0,
  mtime: "2025-01-01T00:00:00Z",
  metadata: {},
});

describe("formatVirtualFileTree", () => {
  it("renders a flat list of files", () => {
    const tree = formatVirtualFileTree([entry("/a.txt"), entry("/b.txt")]);
    expect(tree).toContain("a.txt");
    expect(tree).toContain("b.txt");
    expect(tree).toMatch(/^\//);
  });

  it("renders nested directory structure", () => {
    const tree = formatVirtualFileTree([
      entry("/src/index.ts"),
      entry("/src/utils/helpers.ts"),
      entry("/package.json"),
    ]);
    expect(tree).toContain("src/");
    expect(tree).toContain("index.ts");
    expect(tree).toContain("utils/");
    expect(tree).toContain("helpers.ts");
    expect(tree).toContain("package.json");
  });

  it("sorts directories before files by default", () => {
    const tree = formatVirtualFileTree([
      entry("/z-file.txt"),
      entry("/a-dir/child.txt"),
    ]);
    const dirIdx = tree.indexOf("a-dir/");
    const fileIdx = tree.indexOf("z-file.txt");
    expect(dirIdx).toBeLessThan(fileIdx);
  });

  it("preserves insertion order when sort is false", () => {
    const tree = formatVirtualFileTree(
      [entry("/z.txt"), entry("/a.txt")],
      { sort: false }
    );
    const zIdx = tree.indexOf("z.txt");
    const aIdx = tree.indexOf("a.txt");
    expect(zIdx).toBeLessThan(aIdx);
  });

  it("handles empty entries array", () => {
    const tree = formatVirtualFileTree([]);
    expect(tree).toBe("/");
  });

  it("uses tree branch characters", () => {
    const tree = formatVirtualFileTree([entry("/first.txt"), entry("/last.txt")]);
    expect(tree).toContain("├─");
    expect(tree).toContain("└─");
  });

  it("handles deeply nested paths", () => {
    const tree = formatVirtualFileTree([entry("/a/b/c/d/file.txt")]);
    expect(tree).toContain("a/");
    expect(tree).toContain("b/");
    expect(tree).toContain("c/");
    expect(tree).toContain("d/");
    expect(tree).toContain("file.txt");
  });
});
