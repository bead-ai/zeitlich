import { Daytona, type Sandbox as DaytonaSdkSandbox } from "@daytonaio/sdk";
import type {
  Sandbox,
  SandboxCapabilities,
  SandboxCapability,
  SandboxCreateResult,
  SandboxProvider,
  ExecOptions,
  ExecResult,
} from "../../../lib/sandbox/types";
import { SandboxNotFoundError } from "../../../lib/sandbox/types";
import { DaytonaSandboxFileSystem } from "./filesystem";
import type {
  DaytonaSandbox,
  DaytonaSandboxConfig,
  DaytonaSandboxCreateOptions,
} from "./types";

// ============================================================================
// DaytonaSandbox
// ============================================================================

class DaytonaSandboxImpl implements Sandbox {
  readonly capabilities: SandboxCapabilities = {
    filesystem: true,
    execution: true,
    persistence: false,
  };

  readonly fs: DaytonaSandboxFileSystem;

  constructor(
    readonly id: string,
    private sdkSandbox: DaytonaSdkSandbox,
    workspaceBase = "/home/daytona"
  ) {
    this.fs = new DaytonaSandboxFileSystem(sdkSandbox, workspaceBase);
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    const response = await this.sdkSandbox.process.executeCommand(
      command,
      options?.cwd,
      options?.env,
      options?.timeout
    );

    return {
      exitCode: response.exitCode ?? 0,
      stdout: response.result ?? "",
      stderr: "",
    };
  }

  async destroy(): Promise<void> {
    await this.sdkSandbox.delete(60);
  }
}

// ============================================================================
// DaytonaSandboxProvider
// ============================================================================

/**
 * Daytona implements only base sandbox lifecycle (`create` / `get` /
 * `destroy`). Snapshot, restore, fork, pause, and resume are not supported
 * — the type-level capability set is `never`, so calling any of those
 * methods on a Daytona provider, manager, or `SandboxOps` proxy is a
 * compile-time TypeScript error.
 */
export class DaytonaSandboxProvider
  implements
    SandboxProvider<DaytonaSandboxCreateOptions, DaytonaSandbox, never>
{
  readonly id = "daytona";
  readonly capabilities: SandboxCapabilities = {
    filesystem: true,
    execution: true,
    persistence: false,
  };
  readonly supportedCapabilities: ReadonlySet<SandboxCapability> = new Set();

  private client: Daytona;
  private readonly defaultWorkspaceBase: string;

  constructor(config?: DaytonaSandboxConfig) {
    this.client = new Daytona(config);
    this.defaultWorkspaceBase = config?.workspaceBase ?? "/home/daytona";
  }

  async create(
    options?: DaytonaSandboxCreateOptions
  ): Promise<SandboxCreateResult> {
    const sdkSandbox = await this.client.create(
      {
        language: options?.language,
        snapshot: options?.snapshot,
        envVars: options?.env,
        labels: options?.labels,
        autoStopInterval: options?.autoStopInterval,
        autoArchiveInterval: options?.autoArchiveInterval,
        autoDeleteInterval: options?.autoDeleteInterval,
      },
      { timeout: options?.timeout ?? 60 }
    );

    const workspaceBase = options?.workspaceBase ?? this.defaultWorkspaceBase;

    const sandbox = new DaytonaSandboxImpl(
      sdkSandbox.id,
      sdkSandbox,
      workspaceBase
    );

    if (options?.initialFiles) {
      await sandbox.fs.writeFiles(
        Object.entries(options.initialFiles).map(([path, content]) => ({
          path,
          content,
        }))
      );
    }

    return { sandbox };
  }

  async get(sandboxId: string): Promise<DaytonaSandbox> {
    try {
      const sdkSandbox = await this.client.get(sandboxId);
      return new DaytonaSandboxImpl(
        sdkSandbox.id,
        sdkSandbox,
        this.defaultWorkspaceBase
      );
    } catch {
      throw new SandboxNotFoundError(sandboxId);
    }
  }

  async destroy(sandboxId: string): Promise<void> {
    try {
      const sdkSandbox = await this.client.get(sandboxId);
      await this.client.delete(sdkSandbox);
    } catch {
      // Already gone
    }
  }
}

// Re-exports
export { DaytonaSandboxFileSystem } from "./filesystem";
export type {
  DaytonaSandbox,
  DaytonaSandboxConfig,
  DaytonaSandboxCreateOptions,
} from "./types";
