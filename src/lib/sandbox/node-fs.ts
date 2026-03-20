import { promises as fsp } from "node:fs";
import { resolve, posix } from "node:path";
import type { SandboxFileSystem, DirentEntry, FileStat } from "./types";

/**
 * Thin adapter from Node.js `fs` to {@link SandboxFileSystem}.
 *
 * All paths are resolved relative to {@link workspaceBase} using
 * `node:path.resolve` (OS-native). Useful for loading skills from the
 * worker's local disk inside a Temporal activity.
 *
 * @example
 * ```typescript
 * import { NodeFsSandboxFileSystem, FileSystemSkillProvider } from 'zeitlich';
 *
 * const fs = new NodeFsSandboxFileSystem('/path/to/skills-root');
 * const provider = new FileSystemSkillProvider(fs, '/');
 * const skills = await provider.loadAll();
 * ```
 */
export class NodeFsSandboxFileSystem implements SandboxFileSystem {
  readonly workspaceBase: string;

  constructor(workspaceBase: string) {
    this.workspaceBase = workspaceBase;
  }

  private abs(path: string): string {
    return resolve(this.workspaceBase, path);
  }

  async readFile(path: string): Promise<string> {
    return fsp.readFile(this.abs(path), "utf-8");
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    return fsp.readFile(this.abs(path));
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    await fsp.writeFile(this.abs(path), content);
  }

  async appendFile(path: string, content: string | Uint8Array): Promise<void> {
    await fsp.appendFile(this.abs(path), content);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fsp.access(this.abs(path));
      return true;
    } catch {
      return false;
    }
  }

  async stat(path: string): Promise<FileStat> {
    const s = await fsp.stat(this.abs(path));
    return {
      isFile: s.isFile(),
      isDirectory: s.isDirectory(),
      isSymbolicLink: s.isSymbolicLink(),
      size: s.size,
      mtime: s.mtime,
    };
  }

  async mkdir(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    await fsp.mkdir(this.abs(path), options);
  }

  async readdir(path: string): Promise<string[]> {
    return fsp.readdir(this.abs(path));
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    const entries = await fsp.readdir(this.abs(path), { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      isFile: e.isFile(),
      isDirectory: e.isDirectory(),
      isSymbolicLink: e.isSymbolicLink(),
    }));
  }

  async rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void> {
    await fsp.rm(this.abs(path), options);
  }

  async cp(
    src: string,
    dest: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    await fsp.cp(this.abs(src), this.abs(dest), options);
  }

  async mv(src: string, dest: string): Promise<void> {
    await fsp.rename(this.abs(src), this.abs(dest));
  }

  async readlink(path: string): Promise<string> {
    return fsp.readlink(this.abs(path));
  }

  resolvePath(base: string, path: string): string {
    return posix.resolve(base, path);
  }
}
