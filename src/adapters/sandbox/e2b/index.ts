import { Sandbox as E2bSdkSandbox } from "@e2b/code-interpreter";
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

  private readonly defaultTemplate?: string;
  private readonly defaultWorkspaceBase: string;
  private readonly defaultTimeoutMs?: number;

  constructor(config?: E2bSandboxConfig) {
    this.defaultTemplate = config?.template;
    this.defaultWorkspaceBase = config?.workspaceBase ?? "/home/user";
    this.defaultTimeoutMs = config?.timeoutMs;
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
    options?: E2bSandboxCreateOptions
  ): Promise<SandboxSnapshot> {
    const { snapshotId } = await E2bSdkSandbox.createSnapshot(sandboxId);
    // E2B doesn't carry sandbox-level config (network policy, metadata,
    // lifecycle, timeoutMs, …) across snapshot/restore — those are pure
    // create-time inputs. Persist them inside the snapshot so `restore` can
    // re-apply them transparently. Strip `initialFiles` — the files are
    // already baked into the snapshot and re-applying them on every restore
    // would overwrite agent-modified state with stale seed content.
    const persistedOptions = sanitizeOptionsForSnapshot(options);
    return {
      sandboxId,
      providerId: this.id,
      data: {
        snapshotId,
        ...(persistedOptions && { createOptions: persistedOptions }),
      },
      createdAt: new Date().toISOString(),
    };
  }

  async restore(
    snapshot: SandboxSnapshot,
    options?: E2bSandboxCreateOptions
  ): Promise<Sandbox> {
    const data = snapshot.data as {
      snapshotId?: string;
      createOptions?: E2bSandboxCreateOptions;
    } | null;
    if (!data?.snapshotId) {
      throw new SandboxNotSupportedError(
        "restore: snapshot is missing snapshotId"
      );
    }
    // Caller overrides win over anything persisted at snapshot time.
    const effective = mergeOptions(data.createOptions, options);
    const sdkOpts = this.buildSdkCreateOpts(effective);
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
  ): Promise<Sandbox> {
    const { snapshotId } = await E2bSdkSandbox.createSnapshot(sandboxId);
    // Re-apply sandbox-level config from the source sandbox — E2B treats
    // `create(snapshotId, opts)` as a fresh create, so without this the fork
    // would come up with default (unrestricted) network/timeout/etc.
    const sdkOpts = this.buildSdkCreateOpts(
      sanitizeOptionsForSnapshot(options)
    );
    const sdkSandbox = await E2bSdkSandbox.create(snapshotId, sdkOpts);
    return new E2bSandboxImpl(
      sdkSandbox.sandboxId,
      sdkSandbox,
      this.defaultWorkspaceBase
    );
  }

  private buildSdkCreateOpts(options?: E2bSandboxCreateOptions) {
    return {
      envs: options?.env,
      timeoutMs: options?.timeoutMs ?? this.defaultTimeoutMs,
      metadata: options?.metadata,
      allowInternetAccess: options?.allowInternetAccess,
      network: options?.network
        ? {
            allowOut: options.network.allowOut,
            denyOut: options.network.denyOut,
            allowPublicTraffic: options.network.allowPublicTraffic,
          }
        : undefined,
      lifecycle: options?.lifecycle
        ? {
            onTimeout: options.lifecycle.onTimeout,
            autoResume: options.lifecycle.autoResume,
          }
        : undefined,
    };
  }
}

/**
 * Strip fields that shouldn't survive into a snapshot or fork: `initialFiles`
 * is a seed concept (files are already baked into the snapshot), `id` is
 * per-sandbox. Returns `undefined` when the remainder is empty so snapshots
 * stay minimal for callers that never pass options.
 */
function sanitizeOptionsForSnapshot(
  options?: E2bSandboxCreateOptions
): E2bSandboxCreateOptions | undefined {
  if (!options) return undefined;
  const { initialFiles: _initialFiles, id: _id, ...rest } = options;
  return Object.keys(rest).length > 0
    ? (rest as E2bSandboxCreateOptions)
    : undefined;
}

/**
 * Shallow merge — `override` wins per top-level key. `network` and `lifecycle`
 * are treated as atomic values (overriding `network` replaces the whole
 * block). That matches how the E2B API treats them.
 */
function mergeOptions(
  base?: E2bSandboxCreateOptions,
  override?: E2bSandboxCreateOptions
): E2bSandboxCreateOptions | undefined {
  if (!base) return override;
  if (!override) return base;
  return { ...base, ...override };
}

// Re-exports
export { E2bSandboxFileSystem } from "./filesystem";
export type {
  E2bSandbox,
  E2bSandboxConfig,
  E2bSandboxCreateOptions,
} from "./types";
