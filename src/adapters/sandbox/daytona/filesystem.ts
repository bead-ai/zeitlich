import type { Sandbox as DaytonaSdkSandbox } from "@daytonaio/sdk";
import type {
  SandboxFileSystem,
  DirentEntry,
  FileStat,
} from "../../../lib/sandbox/types";
import { SandboxNotSupportedError } from "../../../lib/sandbox/types";
import { posix } from "node:path";

/**
 * {@link SandboxFileSystem} backed by a Daytona SDK sandbox.
 *
 * Maps zeitlich's filesystem interface to Daytona's `sandbox.fs` and
 * `sandbox.process` APIs. Operations that have no direct Daytona equivalent
 * (e.g. `appendFile`, `cp`) are composed from primitives.
 */
export class DaytonaSandboxFileSystem implements SandboxFileSystem {
  readonly workspaceBase: string;

  constructor(
    private sandbox: DaytonaSdkSandbox,
    workspaceBase = "/home/daytona"
  ) {
    this.workspaceBase = posix.resolve("/", workspaceBase);
  }

  private normalisePath(path: string): string {
    return posix.resolve(this.workspaceBase, path);
  }

  async readFile(path: string): Promise<string> {
    const norm = this.normalisePath(path);
    const buf = await this.sandbox.fs.downloadFile(norm);
    return buf.toString("utf-8");
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const norm = this.normalisePath(path);
    const buf = await this.sandbox.fs.downloadFile(norm);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const norm = this.normalisePath(path);
    const buf =
      typeof content === "string"
        ? Buffer.from(content, "utf-8")
        : Buffer.from(content);
    await this.sandbox.fs.uploadFile(buf, norm);
  }

  async writeFiles(
    files: { path: string; content: string | Uint8Array }[]
  ): Promise<void> {
    await this.sandbox.fs.uploadFiles(
      files.map((f) => ({
        source: Buffer.from(f.content),
        destination: this.normalisePath(f.path),
      }))
    );
  }

  async appendFile(path: string, content: string | Uint8Array): Promise<void> {
    const norm = this.normalisePath(path);
    let existing: Buffer;
    try {
      existing = await this.sandbox.fs.downloadFile(norm);
    } catch {
      return this.writeFile(norm, content);
    }

    const addition =
      typeof content === "string" ? Buffer.from(content, "utf-8") : content;
    const merged = Buffer.concat([existing, Buffer.from(addition)]);
    await this.sandbox.fs.uploadFile(merged, norm);
  }

  async exists(path: string): Promise<boolean> {
    const norm = this.normalisePath(path);
    try {
      await this.sandbox.fs.getFileDetails(norm);
      return true;
    } catch {
      return false;
    }
  }

  async stat(path: string): Promise<FileStat> {
    const norm = this.normalisePath(path);
    const info = await this.sandbox.fs.getFileDetails(norm);
    return {
      isFile: !info.isDir,
      isDirectory: info.isDir,
      isSymbolicLink: false,
      size: info.size,
      mtime: new Date(info.modTime),
    };
  }

  async mkdir(path: string, _options?: { recursive?: boolean }): Promise<void> {
    const norm = this.normalisePath(path);
    await this.sandbox.fs.createFolder(norm, "755");
  }

  async readdir(path: string): Promise<string[]> {
    const norm = this.normalisePath(path);
    const entries = await this.sandbox.fs.listFiles(norm);
    return entries.map((e) => e.name);
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    const norm = this.normalisePath(path);
    const entries = await this.sandbox.fs.listFiles(norm);
    return entries.map((e) => ({
      name: e.name,
      isFile: !e.isDir,
      isDirectory: e.isDir,
      isSymbolicLink: false,
    }));
  }

  async rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean }
  ): Promise<void> {
    const norm = this.normalisePath(path);
    try {
      await this.sandbox.fs.deleteFile(norm, options?.recursive);
    } catch (err) {
      if (!options?.force) throw err;
    }
  }

  async cp(
    src: string,
    dest: string,
    options?: { recursive?: boolean }
  ): Promise<void> {
    const normSrc = this.normalisePath(src);
    const normDest = this.normalisePath(dest);
    const info = await this.sandbox.fs.getFileDetails(normSrc);
    if (info.isDir) {
      if (!options?.recursive) {
        throw new Error(`EISDIR: is a directory (use recursive): ${src}`);
      }
      await this.sandbox.process.executeCommand(
        `cp -r "${normSrc}" "${normDest}"`
      );
    } else {
      await this.sandbox.process.executeCommand(
        `cp "${normSrc}" "${normDest}"`
      );
    }
  }

  async mv(src: string, dest: string): Promise<void> {
    const normSrc = this.normalisePath(src);
    const normDest = this.normalisePath(dest);
    await this.sandbox.fs.moveFiles(normSrc, normDest);
  }

  async readlink(_path: string): Promise<string> {
    throw new SandboxNotSupportedError("readlink");
  }

  resolvePath(base: string, path: string): string {
    return posix.resolve(this.normalisePath(base), path);
  }
}
