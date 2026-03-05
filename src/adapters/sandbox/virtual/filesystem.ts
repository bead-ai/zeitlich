import type {
  SandboxFileSystem,
  DirentEntry,
  FileStat,
} from "../../../lib/sandbox/types";
import { SandboxNotSupportedError } from "../../../lib/sandbox/types";
import type { FileEntry, FileResolver, TreeMutation } from "./types";

/**
 * Normalise a virtual path to a canonical form: absolute, no trailing slash
 * (except root), no double slashes.
 */
function normalisePath(p: string): string {
  if (!p.startsWith("/")) p = "/" + p;
  p = p.replace(/\/+/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/** Return the parent directory of a normalised path ("/a/b" → "/a"). */
function parentDir(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx <= 0 ? "/" : p.slice(0, idx);
}

/**
 * Collect the set of implicit directory paths from a flat file list.
 * E.g. "/a/b/c.ts" contributes "/a/b", "/a", "/".
 */
function inferDirectories(entries: FileEntry[]): Set<string> {
  const dirs = new Set<string>();
  dirs.add("/");
  for (const entry of entries) {
    let dir = parentDir(normalisePath(entry.path));
    while (dir !== "/" && !dirs.has(dir)) {
      dirs.add(dir);
      dir = parentDir(dir);
    }
    dirs.add("/");
  }
  return dirs;
}

/**
 * Ephemeral {@link SandboxFileSystem} backed by a {@link FileResolver}.
 *
 * Created fresh for each tool invocation from the current workflow file tree.
 * Directory structure is inferred from file paths. All mutations are tracked
 * and can be retrieved via {@link getMutations} after the handler completes.
 */
export class VirtualSandboxFileSystem<TCtx = unknown>
  implements SandboxFileSystem
{
  private entries: Map<string, FileEntry>;
  private directories: Set<string>;
  private mutations: TreeMutation[] = [];

  constructor(
    tree: FileEntry[],
    private resolver: FileResolver<TCtx>,
    private ctx: TCtx,
  ) {
    this.entries = new Map(
      tree.map((e) => [normalisePath(e.path), e]),
    );
    this.directories = inferDirectories(tree);
  }

  /** Return all mutations accumulated during this invocation. */
  getMutations(): TreeMutation[] {
    return this.mutations;
  }

  /** Look up a file entry by virtual path. */
  getEntry(path: string): FileEntry | undefined {
    return this.entries.get(normalisePath(path));
  }

  // --------------------------------------------------------------------------
  // Read operations — delegate to resolver lazily
  // --------------------------------------------------------------------------

  async readFile(path: string): Promise<string> {
    const entry = this.entries.get(normalisePath(path));
    if (!entry) throw new Error(`ENOENT: no such file: ${path}`);
    return this.resolver.readFile(entry.id, this.ctx);
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const entry = this.entries.get(normalisePath(path));
    if (!entry) throw new Error(`ENOENT: no such file: ${path}`);
    return this.resolver.readFileBuffer(entry.id, this.ctx);
  }

  // --------------------------------------------------------------------------
  // Metadata operations — pure, resolved from the tree
  // --------------------------------------------------------------------------

  async exists(path: string): Promise<boolean> {
    const norm = normalisePath(path);
    return this.entries.has(norm) || this.directories.has(norm);
  }

  async stat(path: string): Promise<FileStat> {
    const norm = normalisePath(path);
    const entry = this.entries.get(norm);
    if (entry) {
      return {
        isFile: true,
        isDirectory: false,
        isSymbolicLink: false,
        size: entry.size,
        mtime: new Date(entry.mtime),
      };
    }
    if (this.directories.has(norm)) {
      return {
        isFile: false,
        isDirectory: true,
        isSymbolicLink: false,
        size: 0,
        mtime: new Date(),
      };
    }
    throw new Error(`ENOENT: no such file or directory: ${path}`);
  }

  async readdir(path: string): Promise<string[]> {
    const norm = normalisePath(path);
    if (!this.directories.has(norm)) {
      throw new Error(`ENOENT: no such directory: ${path}`);
    }
    const prefix = norm === "/" ? "/" : norm + "/";
    const names = new Set<string>();

    for (const p of this.entries.keys()) {
      if (p.startsWith(prefix)) {
        const rest = p.slice(prefix.length);
        const seg = rest.split("/")[0];
        if (seg) names.add(seg);
      }
    }
    for (const d of this.directories) {
      if (d.startsWith(prefix) && d !== norm) {
        const rest = d.slice(prefix.length);
        const seg = rest.split("/")[0];
        if (seg) names.add(seg);
      }
    }
    return [...names].sort();
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    const names = await this.readdir(path);
    const norm = normalisePath(path);
    const prefix = norm === "/" ? "/" : norm + "/";

    return names.map((name) => {
      const full = prefix + name;
      const isFile = this.entries.has(full);
      const isDirectory = this.directories.has(full);
      return { name, isFile, isDirectory, isSymbolicLink: false };
    });
  }

  // --------------------------------------------------------------------------
  // Write operations — delegate to resolver, record mutations
  // --------------------------------------------------------------------------

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const norm = normalisePath(path);
    const existing = this.entries.get(norm);

    if (existing) {
      await this.resolver.writeFile(existing.id, content, this.ctx);
      const size =
        typeof content === "string"
          ? new TextEncoder().encode(content).byteLength
          : content.byteLength;
      const updated: FileEntry = {
        ...existing,
        size,
        mtime: new Date().toISOString(),
      };
      this.entries.set(norm, updated);
      this.mutations.push({ type: "update", path: norm, entry: updated });
    } else {
      const entry = await this.resolver.createFile(norm, content, this.ctx);
      const normalised = { ...entry, path: norm };
      this.entries.set(norm, normalised);
      this.addParentDirectories(norm);
      this.mutations.push({ type: "add", entry: normalised });
    }
  }

  async appendFile(path: string, content: string | Uint8Array): Promise<void> {
    const norm = normalisePath(path);
    const existing = this.entries.get(norm);

    if (!existing) {
      return this.writeFile(path, content);
    }

    const current = await this.resolver.readFile(existing.id, this.ctx);
    const appended =
      typeof content === "string"
        ? current + content
        : current + new TextDecoder().decode(content);
    await this.resolver.writeFile(existing.id, appended, this.ctx);

    const size = new TextEncoder().encode(appended).byteLength;
    const updated: FileEntry = {
      ...existing,
      size,
      mtime: new Date().toISOString(),
    };
    this.entries.set(norm, updated);
    this.mutations.push({ type: "update", path: norm, entry: updated });
  }

  async mkdir(_path: string, _options?: { recursive?: boolean }): Promise<void> {
    const norm = normalisePath(_path);
    if (this.directories.has(norm)) return;

    if (_options?.recursive) {
      this.addParentDirectories(norm + "/placeholder");
      this.directories.add(norm);
    } else {
      const parent = parentDir(norm);
      if (!this.directories.has(parent)) {
        throw new Error(`ENOENT: no such directory: ${parent}`);
      }
      this.directories.add(norm);
    }
  }

  async rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void> {
    const norm = normalisePath(path);
    const entry = this.entries.get(norm);

    if (entry) {
      await this.resolver.deleteFile(entry.id, this.ctx);
      this.entries.delete(norm);
      this.mutations.push({ type: "remove", path: norm });
      return;
    }

    if (this.directories.has(norm)) {
      if (!options?.recursive) {
        throw new Error(`EISDIR: is a directory (use recursive): ${path}`);
      }
      const prefix = norm === "/" ? "/" : norm + "/";
      for (const [p, e] of this.entries) {
        if (p.startsWith(prefix)) {
          await this.resolver.deleteFile(e.id, this.ctx);
          this.entries.delete(p);
          this.mutations.push({ type: "remove", path: p });
        }
      }
      for (const d of this.directories) {
        if (d.startsWith(prefix)) this.directories.delete(d);
      }
      this.directories.delete(norm);
      return;
    }

    if (!options?.force) {
      throw new Error(`ENOENT: no such file or directory: ${path}`);
    }
  }

  async cp(
    src: string,
    dest: string,
    _options?: { recursive?: boolean },
  ): Promise<void> {
    const normSrc = normalisePath(src);
    const normDest = normalisePath(dest);

    const entry = this.entries.get(normSrc);
    if (entry) {
      const content = await this.resolver.readFile(entry.id, this.ctx);
      await this.writeFile(normDest, content);
      return;
    }

    if (!this.directories.has(normSrc)) {
      throw new Error(`ENOENT: no such file or directory: ${src}`);
    }
    if (!_options?.recursive) {
      throw new Error(`EISDIR: is a directory (use recursive): ${src}`);
    }

    const prefix = normSrc === "/" ? "/" : normSrc + "/";
    for (const [p, e] of this.entries) {
      if (p.startsWith(prefix)) {
        const relative = p.slice(normSrc.length);
        const content = await this.resolver.readFile(e.id, this.ctx);
        await this.writeFile(normDest + relative, content);
      }
    }
  }

  async mv(src: string, dest: string): Promise<void> {
    await this.cp(src, dest, { recursive: true });
    await this.rm(src, { recursive: true });
  }

  // --------------------------------------------------------------------------
  // Unsupported
  // --------------------------------------------------------------------------

  async readlink(_path: string): Promise<string> {
    throw new SandboxNotSupportedError("readlink");
  }

  resolvePath(base: string, path: string): string {
    if (path.startsWith("/")) return normalisePath(path);
    const combined =
      base.endsWith("/") ? base + path : base + "/" + path;
    return normalisePath(combined);
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private addParentDirectories(filePath: string): void {
    let dir = parentDir(normalisePath(filePath));
    while (!this.directories.has(dir)) {
      this.directories.add(dir);
      dir = parentDir(dir);
    }
  }
}
