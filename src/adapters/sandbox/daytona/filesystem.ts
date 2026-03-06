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
  constructor(private sandbox: DaytonaSdkSandbox) {}

  async readFile(path: string): Promise<string> {
    const buf = await this.sandbox.fs.downloadFile(path);
    return buf.toString("utf-8");
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const buf = await this.sandbox.fs.downloadFile(path);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const buf =
      typeof content === "string"
        ? Buffer.from(content, "utf-8")
        : Buffer.from(content);
    await this.sandbox.fs.uploadFile(buf, path);
  }

  async appendFile(
    path: string,
    content: string | Uint8Array,
  ): Promise<void> {
    let existing: Buffer;
    try {
      existing = await this.sandbox.fs.downloadFile(path);
    } catch {
      return this.writeFile(path, content);
    }

    const addition =
      typeof content === "string" ? Buffer.from(content, "utf-8") : content;
    const merged = Buffer.concat([existing, Buffer.from(addition)]);
    await this.sandbox.fs.uploadFile(merged, path);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.sandbox.fs.getFileDetails(path);
      return true;
    } catch {
      return false;
    }
  }

  async stat(path: string): Promise<FileStat> {
    const info = await this.sandbox.fs.getFileDetails(path);
    return {
      isFile: !info.isDir,
      isDirectory: info.isDir,
      isSymbolicLink: false,
      size: info.size,
      mtime: new Date(info.modTime),
    };
  }

  async mkdir(
    path: string,
    _options?: { recursive?: boolean },
  ): Promise<void> {
    await this.sandbox.fs.createFolder(path, "755");
  }

  async readdir(path: string): Promise<string[]> {
    const entries = await this.sandbox.fs.listFiles(path);
    return entries.map((e) => e.name);
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    const entries = await this.sandbox.fs.listFiles(path);
    return entries.map((e) => ({
      name: e.name,
      isFile: !e.isDir,
      isDirectory: e.isDir,
      isSymbolicLink: false,
    }));
  }

  async rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void> {
    try {
      await this.sandbox.fs.deleteFile(path, options?.recursive);
    } catch (err) {
      if (!options?.force) throw err;
    }
  }

  async cp(
    src: string,
    dest: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    const info = await this.sandbox.fs.getFileDetails(src);
    if (info.isDir) {
      if (!options?.recursive) {
        throw new Error(`EISDIR: is a directory (use recursive): ${src}`);
      }
      await this.sandbox.process.executeCommand(`cp -r "${src}" "${dest}"`);
    } else {
      await this.sandbox.process.executeCommand(`cp "${src}" "${dest}"`);
    }
  }

  async mv(src: string, dest: string): Promise<void> {
    await this.sandbox.fs.moveFiles(src, dest);
  }

  async readlink(_path: string): Promise<string> {
    throw new SandboxNotSupportedError("readlink");
  }

  resolvePath(base: string, path: string): string {
    if (posix.isAbsolute(path)) return posix.normalize(path);
    return posix.resolve(base, path);
  }
}
