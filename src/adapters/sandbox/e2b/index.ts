import { Sandbox as E2bSdkSandbox } from "@e2b/code-interpreter";
import type {
  Sandbox,
  SandboxCapabilities,
  SandboxCapability,
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
import { E2bSandboxFileSystem } from "./filesystem";
import type {
  E2bSandbox,
  E2bSandboxConfig,
  E2bSandboxCreateOptions,
} from "./types";

// ============================================================================
// E2bSandbox
// ============================================================================

class E2bSandboxImpl implements Sandbox {
  readonly capabilities: SandboxCapabilities = {
    filesystem: true,
    execution: true,
    persistence: true,
  };

  readonly fs: E2bSandboxFileSystem;

  constructor(
    readonly id: string,
    private sdkSandbox: E2bSdkSandbox,
    workspaceBase = "/home/user"
  ) {
    this.fs = new E2bSandboxFileSystem(sdkSandbox, workspaceBase);
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    const result = await this.sdkSandbox.commands.run(command, {
      cwd: options?.cwd,
      envs: options?.env,
      timeoutMs: options?.timeout,
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  async destroy(): Promise<void> {
    await this.sdkSandbox.kill();
  }
}

// ============================================================================
// E2bSandboxProvider
// ============================================================================

export class E2bSandboxProvider implements SandboxProvider<
  E2bSandboxCreateOptions,
  E2bSandbox
> {
  readonly id = "e2b";
  readonly capabilities: SandboxCapabilities = {
    filesystem: true,
    execution: true,
    persistence: true,
  };
  readonly supportedCapabilities: ReadonlySet<SandboxCapability> = new Set([
    "pause",
    "resume",
    "snapshot",
    "restore",
    "fork",
  ]);

  private readonly defaultTemplate?: string;
  private readonly defaultWorkspaceBase: string;
  private readonly defaultTimeoutMs?: number;
  private readonly defaultAllowInternetAccess?: boolean;
  private readonly defaultNetwork?: E2bSandboxConfig["network"];
  private readonly defaultMetadata?: E2bSandboxConfig["metadata"];
  private readonly defaultLifecycle?: E2bSandboxConfig["lifecycle"];

  constructor(config?: E2bSandboxConfig) {
    this.defaultTemplate = config?.template;
    this.defaultWorkspaceBase = config?.workspaceBase ?? "/home/user";
    this.defaultTimeoutMs = config?.timeoutMs;
    this.defaultAllowInternetAccess = config?.allowInternetAccess;
    this.defaultNetwork = config?.network;
    this.defaultMetadata = config?.metadata;
    this.defaultLifecycle = config?.lifecycle;
  }

  async create(
    options?: E2bSandboxCreateOptions
  ): Promise<SandboxCreateResult> {
    const template = options?.template ?? this.defaultTemplate;
    const workspaceBase = this.defaultWorkspaceBase;
    const createOpts = this.buildSdkCreateOpts(options);

    const sdkSandbox = template
      ? await E2bSdkSandbox.create(template, createOpts)
      : await E2bSdkSandbox.create(createOpts);

    const sandbox = new E2bSandboxImpl(
      sdkSandbox.sandboxId,
      sdkSandbox,
      workspaceBase
    );

    if (options?.initialFiles) {
      await Promise.all(
        Object.entries(options.initialFiles).map(([path, content]) =>
          sandbox.fs.writeFile(path, content)
        )
      );
    }

    return { sandbox };
  }

  async get(sandboxId: string): Promise<E2bSandbox> {
    try {
      const sdkSandbox = await E2bSdkSandbox.connect(sandboxId);
      return new E2bSandboxImpl(
        sandboxId,
        sdkSandbox,
        this.defaultWorkspaceBase
      );
    } catch {
      throw new SandboxNotFoundError(sandboxId);
    }
  }

  async destroy(sandboxId: string): Promise<void> {
    try {
      const sdkSandbox = await E2bSdkSandbox.connect(sandboxId);
      await sdkSandbox.kill();
    } catch {
      // Already gone or not found
    }
  }

  async pause(sandboxId: string, _ttlSeconds?: number): Promise<void> {
    const sdkSandbox = await E2bSdkSandbox.connect(sandboxId);
    await sdkSandbox.pause();
  }

  async resume(sandboxId: string): Promise<void> {
    await E2bSdkSandbox.connect(sandboxId);
  }

  async snapshot(
    sandboxId: string,
    _options?: E2bSandboxCreateOptions
  ): Promise<SandboxSnapshot> {
    const { snapshotId } = await E2bSdkSandbox.createSnapshot(sandboxId);
    return {
      sandboxId,
      providerId: this.id,
      data: { snapshotId },
      createdAt: new Date().toISOString(),
    };
  }

  async restore(
    snapshot: SandboxSnapshot,
    options?: E2bSandboxCreateOptions
  ): Promise<E2bSandbox> {
    const data = snapshot.data as { snapshotId?: string } | null;
    if (!data?.snapshotId) {
      throw new SandboxNotSupportedError(
        "restore: snapshot is missing snapshotId"
      );
    }
    const sdkOpts = this.buildSdkCreateOpts(options);
    const sdkSandbox = await E2bSdkSandbox.create(data.snapshotId, sdkOpts);
    return new E2bSandboxImpl(
      sdkSandbox.sandboxId,
      sdkSandbox,
      this.defaultWorkspaceBase
    );
  }

  async deleteSnapshot(snapshot: SandboxSnapshot): Promise<void> {
    const data = snapshot.data as { snapshotId?: string } | null;
    if (!data?.snapshotId) return;
    try {
      await E2bSdkSandbox.deleteSnapshot(data.snapshotId);
    } catch {
      // Already deleted or no longer accessible — treat as no-op.
    }
  }

  async fork(
    sandboxId: string,
    options?: E2bSandboxCreateOptions
  ): Promise<E2bSandbox> {
    const { snapshotId } = await E2bSdkSandbox.createSnapshot(sandboxId);
    const sdkOpts = this.buildSdkCreateOpts(options);
    const sdkSandbox = await E2bSdkSandbox.create(snapshotId, sdkOpts);
    return new E2bSandboxImpl(
      sdkSandbox.sandboxId,
      sdkSandbox,
      this.defaultWorkspaceBase
    );
  }

  private buildSdkCreateOpts(options?: E2bSandboxCreateOptions) {
    const network = options?.network ?? this.defaultNetwork;
    const lifecycle = options?.lifecycle ?? this.defaultLifecycle;
    return {
      envs: options?.env,
      timeoutMs: options?.timeoutMs ?? this.defaultTimeoutMs,
      metadata: options?.metadata ?? this.defaultMetadata,
      allowInternetAccess:
        options?.allowInternetAccess ?? this.defaultAllowInternetAccess,
      network: network
        ? {
            allowOut: network.allowOut,
            denyOut: network.denyOut,
            allowPublicTraffic: network.allowPublicTraffic,
          }
        : undefined,
      lifecycle: lifecycle
        ? {
            onTimeout: lifecycle.onTimeout,
            autoResume: lifecycle.autoResume,
          }
        : undefined,
    };
  }
}

// Re-exports
export { E2bSandboxFileSystem } from "./filesystem";
export type {
  E2bSandbox,
  E2bSandboxConfig,
  E2bSandboxCreateOptions,
} from "./types";
