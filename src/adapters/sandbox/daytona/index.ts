import {
  Daytona,
  type Sandbox as DaytonaSdkSandbox,
} from "@daytonaio/sdk";
import type {
  Sandbox,
  SandboxCapabilities,
  SandboxCreateResult,
  SandboxProvider,
  SandboxSnapshot,
  ExecOptions,
  ExecResult,
} from "../../../lib/sandbox/types";
import {
  SandboxNotFoundError,
  SandboxNotSupportedError,
} from "../../../lib/sandbox/types";
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
    workspaceBase = "/home/daytona",
  ) {
    this.fs = new DaytonaSandboxFileSystem(sdkSandbox, workspaceBase);
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    const response = await this.sdkSandbox.process.executeCommand(
      command,
      options?.cwd,
      options?.env,
      options?.timeout,
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

export class DaytonaSandboxProvider
  implements SandboxProvider<DaytonaSandboxCreateOptions, DaytonaSandbox>
{
  readonly id = "daytona";
  readonly capabilities: SandboxCapabilities = {
    filesystem: true,
    execution: true,
    persistence: false,
  };

  private client: Daytona;
  private readonly defaultWorkspaceBase: string;
  private workspaceBaseById = new Map<string, string>();

  constructor(config?: DaytonaSandboxConfig) {
    this.client = new Daytona(config);
    this.defaultWorkspaceBase = config?.workspaceBase ?? "/home/daytona";
  }

  async create(
    options?: DaytonaSandboxCreateOptions,
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
      { timeout: options?.timeout ?? 60 },
    );

    const workspaceBase = options?.workspaceBase ?? this.defaultWorkspaceBase;
    this.workspaceBaseById.set(sdkSandbox.id, workspaceBase);
    const sandbox = new DaytonaSandboxImpl(
      sdkSandbox.id,
      sdkSandbox,
      workspaceBase,
    );

    if (options?.initialFiles) {
      for (const [path, content] of Object.entries(options.initialFiles)) {
        await sandbox.fs.writeFile(path, content);
      }
    }

    return { sandbox };
  }

  async get(sandboxId: string): Promise<DaytonaSandbox> {
    try {
      const sdkSandbox = await this.client.get(sandboxId);
      const workspaceBase =
        this.workspaceBaseById.get(sandboxId) ?? this.defaultWorkspaceBase;
      return new DaytonaSandboxImpl(sdkSandbox.id, sdkSandbox, workspaceBase);
    } catch {
      throw new SandboxNotFoundError(sandboxId);
    }
  }

  async destroy(sandboxId: string): Promise<void> {
    try {
      const sdkSandbox = await this.client.get(sandboxId);
      await this.client.delete(sdkSandbox);
      this.workspaceBaseById.delete(sandboxId);
    } catch {
      // Already gone
    }
  }

  async snapshot(_sandboxId: string): Promise<SandboxSnapshot> {
    throw new SandboxNotSupportedError(
      "snapshot (use Daytona's native snapshot API directly)",
    );
  }

  async restore(_snapshot: SandboxSnapshot): Promise<never> {
    throw new SandboxNotSupportedError(
      "restore (use Daytona's native snapshot API directly)",
    );
  }
}

// Re-exports
export { DaytonaSandboxFileSystem } from "./filesystem";
export type {
  DaytonaSandbox,
  DaytonaSandboxConfig,
  DaytonaSandboxCreateOptions,
} from "./types";
