import { Bash, InMemoryFs, type BashOptions, type IFileSystem, type InitialFiles } from "just-bash";
import type {
  Sandbox,
  SandboxCapabilities,
  SandboxCreateOptions,
  SandboxFileSystem,
  SandboxProvider,
  SandboxSnapshot,
  ExecOptions,
  ExecResult,
  DirentEntry,
  FileStat,
} from "../../../lib/sandbox/types";
import { SandboxNotFoundError } from "../../../lib/sandbox/types";
import { getShortId } from "../../../lib/thread-id";

// ============================================================================
// Adapter: IFileSystem → SandboxFileSystem
// ============================================================================

function toSandboxFs(fs: IFileSystem): SandboxFileSystem {
  return {
    readFile: (path) => fs.readFile(path),
    readFileBuffer: (path) => fs.readFileBuffer(path),
    writeFile: (path, content) => fs.writeFile(path, content),
    appendFile: (path, content) => fs.appendFile(path, content),
    exists: (path) => fs.exists(path),
    stat: async (path): Promise<FileStat> => {
      const s = await fs.stat(path);
      return {
        isFile: s.isFile,
        isDirectory: s.isDirectory,
        isSymbolicLink: s.isSymbolicLink,
        size: s.size,
        mtime: s.mtime,
      };
    },
    mkdir: (path, opts) => fs.mkdir(path, opts),
    readdir: (path) => fs.readdir(path),
    readdirWithFileTypes: async (path): Promise<DirentEntry[]> => {
      if (!fs.readdirWithFileTypes) {
        const names = await fs.readdir(path);
        return Promise.all(
          names.map(async (name) => {
            const s = await fs.stat(`${path}/${name}`);
            return {
              name,
              isFile: s.isFile,
              isDirectory: s.isDirectory,
              isSymbolicLink: s.isSymbolicLink,
            };
          }),
        );
      }
      return fs.readdirWithFileTypes(path);
    },
    rm: (path, opts) => fs.rm(path, opts),
    cp: (src, dest, opts) => fs.cp(src, dest, opts),
    mv: (src, dest) => fs.mv(src, dest),
    readlink: (path) => fs.readlink(path),
    resolvePath: (base, p) => fs.resolvePath(base, p),
  };
}

// ============================================================================
// InMemorySandbox
// ============================================================================

export interface InMemorySandboxOptions {
  /** Options forwarded to `just-bash` `Bash` (minus `fs` which is managed) */
  bashOptions?: Omit<BashOptions, "fs">;
}

class InMemorySandbox implements Sandbox {
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
    options?: InMemorySandboxOptions,
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

  private sandboxes = new Map<string, InMemorySandbox>();

  constructor(private defaultOptions?: InMemorySandboxOptions) {}

  async create(options?: SandboxCreateOptions): Promise<Sandbox> {
    const id = options?.id ?? getShortId();
    const initialFiles: InitialFiles = {};

    if (options?.initialFiles) {
      for (const [path, content] of Object.entries(options.initialFiles)) {
        initialFiles[path] = content;
      }
    }

    const fs = new InMemoryFs(initialFiles);
    const sandbox = new InMemorySandbox(id, fs, this.defaultOptions);
    this.sandboxes.set(id, sandbox);
    return sandbox;
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

  async restore(snapshot: SandboxSnapshot): Promise<Sandbox> {
    const { files } = snapshot.data as { files: Record<string, string> };
    const initialFiles: InitialFiles = {};
    for (const [path, content] of Object.entries(files)) {
      initialFiles[path] = content;
    }

    const fs = new InMemoryFs(initialFiles);
    const sandbox = new InMemorySandbox(
      snapshot.sandboxId,
      fs,
      this.defaultOptions,
    );
    this.sandboxes.set(sandbox.id, sandbox);
    return sandbox;
  }
}
