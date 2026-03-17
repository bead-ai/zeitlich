import {
  Bash,
  InMemoryFs,
  type BashOptions,
  type IFileSystem,
  type InitialFiles,
} from "just-bash";
import type {
  Sandbox,
  SandboxCapabilities,
  SandboxCreateOptions,
  SandboxCreateResult,
  SandboxFileSystem,
  SandboxProvider,
  SandboxSnapshot,
  ExecOptions,
  ExecResult,
  DirentEntry,
  FileStat,
} from "../../../lib/sandbox/types";
import { SandboxNotFoundError, SandboxNotSupportedError } from "../../../lib/sandbox/types";
import { getShortId } from "../../../lib/thread/id";

// ============================================================================
// Adapter: IFileSystem → SandboxFileSystem
// ============================================================================

function toSandboxFs(fs: IFileSystem): SandboxFileSystem {
  const workspaceBase = "/";
  const normalisePath = (path: string): string => fs.resolvePath(workspaceBase, path);

  return {
    workspaceBase,
    readFile: (path) => fs.readFile(normalisePath(path)),
    readFileBuffer: (path) => fs.readFileBuffer(normalisePath(path)),
    writeFile: (path, content) => fs.writeFile(normalisePath(path), content),
    appendFile: (path, content) => fs.appendFile(normalisePath(path), content),
    exists: (path) => fs.exists(normalisePath(path)),
    stat: async (path): Promise<FileStat> => {
      const s = await fs.stat(normalisePath(path));
      return {
        isFile: s.isFile,
        isDirectory: s.isDirectory,
        isSymbolicLink: s.isSymbolicLink,
        size: s.size,
        mtime: s.mtime,
      };
    },
    mkdir: (path, opts) => fs.mkdir(normalisePath(path), opts),
    readdir: (path) => fs.readdir(normalisePath(path)),
    readdirWithFileTypes: async (path): Promise<DirentEntry[]> => {
      const dirPath = normalisePath(path);
      if (!fs.readdirWithFileTypes) {
        const names = await fs.readdir(dirPath);
        return Promise.all(
          names.map(async (name) => {
            const childPath = fs.resolvePath(dirPath, name);
            const s = await fs.stat(childPath);
            return {
              name,
              isFile: s.isFile,
              isDirectory: s.isDirectory,
              isSymbolicLink: s.isSymbolicLink,
            };
          })
        );
      }
      return fs.readdirWithFileTypes(dirPath);
    },
    rm: (path, opts) => fs.rm(normalisePath(path), opts),
    cp: (src, dest, opts) => fs.cp(normalisePath(src), normalisePath(dest), opts),
    mv: (src, dest) => fs.mv(normalisePath(src), normalisePath(dest)),
    readlink: (path) => fs.readlink(normalisePath(path)),
    resolvePath: (base, p) => fs.resolvePath(normalisePath(base), p),
  };
}

// ============================================================================
// InMemorySandbox
// ============================================================================

export interface InMemorySandboxOptions {
  /** Options forwarded to `just-bash` `Bash` (minus `fs` which is managed) */
  bashOptions?: Omit<BashOptions, "fs">;
}

/**
 * An in-memory {@link Sandbox} backed by `just-bash`.
 */
export type InMemorySandbox = Sandbox & { fs: SandboxFileSystem };

class InMemorySandboxImpl implements Sandbox {
  readonly capabilities: SandboxCapabilities = {
    filesystem: true,
    execution: true,
    persistence: true,
  };

  readonly fs: SandboxFileSystem;
  private bashOptions: Omit<BashOptions, "fs">;

  constructor(
    readonly id: string,
    private justBashFs: IFileSystem,
    options?: InMemorySandboxOptions
  ) {
    this.fs = toSandboxFs(justBashFs);
    this.bashOptions = {
      executionLimits: { maxStringLength: 52_428_800 },
      ...options?.bashOptions,
    };
  }

  async exec(command: string, _options?: ExecOptions): Promise<ExecResult> {
    const bash = new Bash({ ...this.bashOptions, fs: this.justBashFs });
    const { exitCode, stderr, stdout } = await bash.exec(command);
    return { exitCode, stdout, stderr };
  }

  async destroy(): Promise<void> {
    // In-memory: nothing to clean up
  }

  /** Expose the underlying IFileSystem for snapshot serialisation */
  _getJustBashFs(): IFileSystem {
    return this.justBashFs;
  }
}

// ============================================================================
// InMemorySandboxProvider
// ============================================================================

export class InMemorySandboxProvider implements SandboxProvider {
  readonly id = "inmemory";
  readonly capabilities: SandboxCapabilities = {
    filesystem: true,
    execution: true,
    persistence: true,
  };

  private sandboxes = new Map<string, InMemorySandboxImpl>();

  constructor(private defaultOptions?: InMemorySandboxOptions) {}

  async get(id: string): Promise<Sandbox> {
    const sandbox = this.sandboxes.get(id);
    if (!sandbox) throw new SandboxNotFoundError(id);
    return sandbox;
  }

  async destroy(id: string): Promise<void> {
    const sandbox = this.sandboxes.get(id);
    if (sandbox) {
      await sandbox.destroy();
      this.sandboxes.delete(id);
    }
  }

  async pause(_sandboxId: string, _ttlSeconds?: number): Promise<void> {
    throw new SandboxNotSupportedError("pause");
  }

  async create(options?: SandboxCreateOptions): Promise<SandboxCreateResult> {
    const id = options?.id ?? getShortId();
    const initialFiles: InitialFiles = {};

    if (options?.initialFiles) {
      for (const [path, content] of Object.entries(options.initialFiles)) {
        initialFiles[path] = content;
      }
    }

    const fs = new InMemoryFs(initialFiles);
    const sandbox = new InMemorySandboxImpl(id, fs, this.defaultOptions);
    this.sandboxes.set(id, sandbox);
    return { sandbox };
  }

  async snapshot(sandboxId: string): Promise<SandboxSnapshot> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) throw new SandboxNotFoundError(sandboxId);

    const fs = sandbox._getJustBashFs();
    const paths = fs.getAllPaths();
    const files: Record<string, string> = {};

    for (const p of paths) {
      try {
        const stat = await fs.stat(p);
        if (stat.isFile) {
          files[p] = await fs.readFile(p);
        }
      } catch {
        // skip entries that can't be read (e.g. broken symlinks)
      }
    }

    return {
      sandboxId,
      providerId: this.id,
      data: { files },
      createdAt: new Date().toISOString(),
    };
  }

  async fork(_sandboxId: string): Promise<Sandbox> {
    throw new Error("Not implemented");
  }

  async restore(snapshot: SandboxSnapshot): Promise<Sandbox> {
    const { files } = snapshot.data as { files: Record<string, string> };
    const initialFiles: InitialFiles = {};
    for (const [path, content] of Object.entries(files)) {
      initialFiles[path] = content;
    }

    const fs = new InMemoryFs(initialFiles);
    const sandbox = new InMemorySandboxImpl(
      snapshot.sandboxId,
      fs,
      this.defaultOptions
    );
    this.sandboxes.set(sandbox.id, sandbox);
    return sandbox;
  }
}
