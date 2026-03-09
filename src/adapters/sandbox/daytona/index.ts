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
  ) {
    this.fs = new DaytonaSandboxFileSystem(sdkSandbox);
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
  implements SandboxProvider<DaytonaSandboxCreateOptions>
{
  readonly id = "daytona";
  readonly capabilities: SandboxCapabilities = {
    filesystem: true,
    execution: true,
    persistence: false,
  };

  private client: Daytona;
  private sandboxes = new Map<string, DaytonaSandboxImpl>();

  constructor(config?: DaytonaSandboxConfig) {
    this.client = new Daytona(config);
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

    const sandbox = new DaytonaSandboxImpl(sdkSandbox.id, sdkSandbox);
    this.sandboxes.set(sandbox.id, sandbox);

    if (options?.initialFiles) {
      for (const [path, content] of Object.entries(options.initialFiles)) {
        await sandbox.fs.writeFile(path, content);
      }
    }

    return { sandbox };
  }

  async get(sandboxId: string): Promise<Sandbox> {
    const cached = this.sandboxes.get(sandboxId);
    if (cached) return cached;

    try {
      const sdkSandbox = await this.client.get(sandboxId);
      const sandbox = new DaytonaSandboxImpl(sdkSandbox.id, sdkSandbox);
      this.sandboxes.set(sandbox.id, sandbox);
      return sandbox;
    } catch {
      throw new SandboxNotFoundError(sandboxId);
    }
  }

  async destroy(sandboxId: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (sandbox) {
      await sandbox.destroy();
      this.sandboxes.delete(sandboxId);
      return;
    }

    try {
      const sdkSandbox = await this.client.get(sandboxId);
      await this.client.delete(sdkSandbox);
    } catch {
      // Already gone
    }
  }

  async snapshot(_sandboxId: string): Promise<SandboxSnapshot> {
    throw new SandboxNotSupportedError(
      "snapshot (use Daytona's native snapshot API directly)",
    );
  }

  async restore(_snapshot: SandboxSnapshot): Promise<Sandbox> {
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
