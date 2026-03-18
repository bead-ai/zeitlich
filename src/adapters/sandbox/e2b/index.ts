import { Sandbox as E2bSdkSandbox } from "@e2b/code-interpreter";
import type {
  ExecOptions,
  ExecResult,
  Sandbox,
  SandboxCapabilities,
  SandboxCreateResult,
  SandboxProvider,
  SandboxSnapshot,
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
    workspaceBase = "/home/user",
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

export class E2bSandboxProvider
  implements SandboxProvider<E2bSandboxCreateOptions, E2bSandbox>
{
  readonly id = "e2b";
  readonly capabilities: SandboxCapabilities = {
    filesystem: true,
    execution: true,
    persistence: true,
  };

  private readonly defaultTemplate?: string;
  private readonly defaultWorkspaceBase: string;
  private readonly defaultTimeoutMs?: number;

  constructor(config?: E2bSandboxConfig) {
    this.defaultTemplate = config?.template;
    this.defaultWorkspaceBase = config?.workspaceBase ?? "/home/user";
    this.defaultTimeoutMs = config?.timeoutMs;
  }

  async create(
    options?: E2bSandboxCreateOptions,
  ): Promise<SandboxCreateResult> {
    const template = options?.template ?? this.defaultTemplate;
    const workspaceBase = this.defaultWorkspaceBase;
    const createOpts = {
      envs: options?.env,
      timeoutMs: options?.timeoutMs ?? this.defaultTimeoutMs,
    };

    const sdkSandbox = template
      ? await E2bSdkSandbox.create(template, createOpts)
      : await E2bSdkSandbox.create(createOpts);

    const sandbox = new E2bSandboxImpl(
      sdkSandbox.sandboxId,
      sdkSandbox,
      workspaceBase,
    );

    if (options?.initialFiles) {
      await Promise.all(
        Object.entries(options.initialFiles).map(([path, content]) =>
          sandbox.fs.writeFile(path, content),
        ),
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
        this.defaultWorkspaceBase,
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

  async snapshot(_sandboxId: string): Promise<SandboxSnapshot> {
    throw new SandboxNotSupportedError("snapshot");
  }

  async restore(_snapshot: SandboxSnapshot): Promise<Sandbox> {
    throw new SandboxNotSupportedError("restore");
  }

  async fork(sandboxId: string): Promise<Sandbox> {
    const { snapshotId } = await E2bSdkSandbox.createSnapshot(sandboxId);
    const sdkSandbox = await E2bSdkSandbox.create(snapshotId);
    return new E2bSandboxImpl(
      sdkSandbox.sandboxId,
      sdkSandbox,
      this.defaultWorkspaceBase,
    );
  }
}

// Re-exports
export { E2bSandboxFileSystem } from "./filesystem";
export type {
  E2bSandbox,
  E2bSandboxConfig,
  E2bSandboxCreateOptions,
} from "./types";
