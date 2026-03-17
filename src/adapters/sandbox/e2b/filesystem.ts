import { FileType, type Sandbox as E2bSdkSandbox } from "@e2b/code-interpreter";
import type {
  SandboxFileSystem,
  DirentEntry,
  FileStat,
} from "../../../lib/sandbox/types";
import { posix } from "node:path";

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/**
 * {@link SandboxFileSystem} backed by an E2B SDK sandbox.
 *
 * Maps zeitlich's filesystem interface to E2B's `sandbox.files` and
 * `sandbox.commands` APIs. Operations that have no direct E2B equivalent
 * (e.g. `appendFile`, `cp`) are composed from primitives.
 */
export class E2bSandboxFileSystem implements SandboxFileSystem {
  readonly workspaceBase: string;

  constructor(
    private sandbox: E2bSdkSandbox,
    workspaceBase = "/home/user"
  ) {
    this.workspaceBase = posix.resolve("/", workspaceBase);
  }

  private normalisePath(path: string): string {
    return posix.resolve(this.workspaceBase, path);
  }

  async readFile(path: string): Promise<string> {
    return this.sandbox.files.read(this.normalisePath(path));
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    return this.sandbox.files.read(this.normalisePath(path), {
      format: "bytes",
    });
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const norm = this.normalisePath(path);
    if (typeof content === "string") {
      await this.sandbox.files.write(norm, content);
    } else {
      await this.sandbox.files.write(norm, toArrayBuffer(content));
    }
  }

  async appendFile(path: string, content: string | Uint8Array): Promise<void> {
    const norm = this.normalisePath(path);
    let existing = "";
    try {
      existing = await this.sandbox.files.read(norm);
    } catch {
      // file doesn't exist yet — write from scratch
    }
    const addition =
      typeof content === "string"
        ? content
        : new TextDecoder().decode(content);
    await this.sandbox.files.write(norm, existing + addition);
  }

  async exists(path: string): Promise<boolean> {
    return this.sandbox.files.exists(this.normalisePath(path));
  }

  async stat(path: string): Promise<FileStat> {
    const norm = this.normalisePath(path);
    const info = await this.sandbox.files.getInfo(norm);
    const isSymlink = !!info.symlinkTarget;
    return {
      isFile: isSymlink ? false : info.type === FileType.FILE,
      isDirectory: isSymlink ? false : info.type === FileType.DIR,
      isSymbolicLink: isSymlink,
      size: info.size,
      mtime: info.modifiedTime ?? new Date(0),
    };
  }

  async mkdir(path: string, _options?: { recursive?: boolean }): Promise<void> {
    await this.sandbox.files.makeDir(this.normalisePath(path));
  }

  async readdir(path: string): Promise<string[]> {
    const entries = await this.sandbox.files.list(this.normalisePath(path));
    return entries.map((e) => posix.basename(e.path));
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    const entries = await this.sandbox.files.list(this.normalisePath(path));
    return entries.map((e) => {
      const isSymlink = !!e.symlinkTarget;
      return {
        name: posix.basename(e.path),
        isFile: isSymlink ? false : e.type === FileType.FILE,
        isDirectory: isSymlink ? false : e.type === FileType.DIR,
        isSymbolicLink: isSymlink,
      };
    });
  }

  async rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean }
  ): Promise<void> {
    const norm = this.normalisePath(path);
    try {
      await this.sandbox.files.remove(norm);
    } catch (err) {
      if (!options?.force) throw err;
    }
  }

  async cp(
    src: string,
    dest: string,
    _options?: { recursive?: boolean }
  ): Promise<void> {
    const normSrc = this.normalisePath(src);
    const normDest = this.normalisePath(dest);
    await this.sandbox.commands.run(`cp -r "${normSrc}" "${normDest}"`);
  }

  async mv(src: string, dest: string): Promise<void> {
    const normSrc = this.normalisePath(src);
    const normDest = this.normalisePath(dest);
    await this.sandbox.files.rename(normSrc, normDest);
  }

  async readlink(path: string): Promise<string> {
    const norm = this.normalisePath(path);
    const info = await this.sandbox.files.getInfo(norm);
    if (!info.symlinkTarget) {
      throw new Error(`EINVAL: invalid argument, readlink '${path}'`);
    }
    return info.symlinkTarget;
  }

  resolvePath(base: string, path: string): string {
    return posix.resolve(this.normalisePath(base), path);
  }
}
