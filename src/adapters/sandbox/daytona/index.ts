import {
  Daytona,
  type Sandbox as DaytonaSdkSandbox,
  type VolumeMount,
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
    persistence: true,
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
    persistence: true,
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

  async snapshot(sandboxId: string): Promise<SandboxSnapshot> {
    const workspaceBase =
      this.workspaceBaseById.get(sandboxId) ?? this.defaultWorkspaceBase;

    const volumeName = `snapshot-${sandboxId}-${Date.now()}`;
    const volume = await this.client.volume.create(volumeName);

    try {
      const srcSandbox = await this.client.get(sandboxId);

      // Pack the workspace into an archive inside the running sandbox
      await srcSandbox.process.executeCommand(
        `tar czf /tmp/snapshot.tar.gz -C "${workspaceBase}" .`,
      );
      const archive = await srcSandbox.fs.downloadFile("/tmp/snapshot.tar.gz");

      // Spin up a short-lived sandbox with the volume pre-mounted, extract the
      // archive into it, then delete the sandbox (volume retains the data)
      const tempSandbox = await this.client.create({
        volumes: [
          { volumeId: volume.id, mountPath: workspaceBase } as VolumeMount,
        ],
        autoDeleteInterval: 10,
      });
      try {
        await tempSandbox.fs.uploadFile(archive, "/tmp/snapshot.tar.gz");
        await tempSandbox.process.executeCommand(
          `tar xzf /tmp/snapshot.tar.gz -C "${workspaceBase}"`,
        );
      } finally {
        await this.client.delete(tempSandbox);
      }
    } catch (err) {
      await this.client.volume.delete(volume);
      throw err;
    }

    return {
      sandboxId,
      providerId: this.id,
      data: { volumeId: volume.id, volumeName: volume.name, workspaceBase },
      createdAt: new Date().toISOString(),
    };
  }

  async restore(snapshot: SandboxSnapshot): Promise<Sandbox | null> {
    const { volumeId, workspaceBase } = snapshot.data as {
      volumeId: string;
      workspaceBase: string;
    };

    let volume;
    try {
      // Verify the volume still exists before creating a sandbox from it
      volume = await this.client.volume.get(volumeId);
    } catch {
      return null;
    }

    const sdkSandbox = await this.client.create({
      volumes: [{ volumeId, mountPath: workspaceBase } as VolumeMount],
    });

    // Volume data is now mounted into the sandbox — free the volume
    await this.client.volume.delete(volume);

    this.workspaceBaseById.set(sdkSandbox.id, workspaceBase);
    return new DaytonaSandboxImpl(sdkSandbox.id, sdkSandbox, workspaceBase);
  }
}

// Re-exports
export { DaytonaSandboxFileSystem } from "./filesystem";
export type {
  DaytonaSandbox,
  DaytonaSandboxConfig,
  DaytonaSandboxCreateOptions,
} from "./types";
