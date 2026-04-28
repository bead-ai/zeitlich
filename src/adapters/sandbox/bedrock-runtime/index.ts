import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommandCommand,
  StopRuntimeSessionCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { randomUUID } from "node:crypto";
import type {
  Sandbox,
  SandboxCapabilities,
  SandboxCreateResult,
  SandboxProvider,
  SandboxSnapshot,
  ExecOptions,
  ExecResult,
} from "../../../lib/sandbox/types";
import { SandboxNotSupportedError } from "../../../lib/sandbox/types";
import { q, sh } from "../../../lib/sandbox/shell";
import { BedrockRuntimeSandboxFileSystem } from "./filesystem";
import { consumeCommandStream } from "./stream";
import type {
  BedrockRuntimeSandbox,
  BedrockRuntimeSandboxConfig,
  BedrockRuntimeSandboxCreateOptions,
} from "./types";

/**
 * AgentCore Runtime requires `runtimeSessionId` to be at least 33 characters.
 * Honour a caller-supplied id when it qualifies; otherwise generate a fresh
 * one prefixed with `zeitlich-` and a UUID with hyphens stripped (32 chars).
 */
const SESSION_ID_MIN_LENGTH = 33;

function makeSessionId(preferred?: string): string {
  if (preferred && preferred.length >= SESSION_ID_MIN_LENGTH) return preferred;
  const uuid = randomUUID().replace(/-/g, "");
  return preferred ? `${preferred}-${uuid}`.slice(0, 64) : `zeitlich-${uuid}`;
}

// ============================================================================
// BedrockRuntimeSandboxImpl
// ============================================================================

class BedrockRuntimeSandboxImpl implements Sandbox {
  readonly capabilities: SandboxCapabilities = {
    filesystem: true,
    execution: true,
    // Persistence depends on whether the runtime resource was created with
    // `filesystemConfigurations.sessionStorage`. The adapter cannot detect
    // that, so we declare the capability and leave the runtime config to
    // the caller.
    persistence: true,
  };

  readonly fs: BedrockRuntimeSandboxFileSystem;

  constructor(
    readonly id: string,
    private client: BedrockAgentCoreClient,
    private agentRuntimeArn: string,
    private qualifier: string | undefined,
    private commandTimeoutSeconds: number | undefined,
    workspaceBase: string
  ) {
    this.fs = new BedrockRuntimeSandboxFileSystem(
      client,
      agentRuntimeArn,
      qualifier,
      id,
      commandTimeoutSeconds,
      workspaceBase
    );
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    const finalCmd = sh.withCwdAndEnv(command, {
      cwd: options?.cwd,
      env: options?.env,
    });

    // ExecOptions.timeout is milliseconds (matches the E2B adapter). The
    // Runtime API expects seconds — round up so a 1500 ms request gets 2 s.
    const timeoutSeconds =
      options?.timeout != null
        ? Math.max(1, Math.ceil(options.timeout / 1000))
        : this.commandTimeoutSeconds;

    const resp = await this.client.send(
      new InvokeAgentRuntimeCommandCommand({
        agentRuntimeArn: this.agentRuntimeArn,
        runtimeSessionId: this.id,
        qualifier: this.qualifier,
        contentType: "application/json",
        accept: "application/vnd.amazon.eventstream",
        body: {
          command: `/bin/bash -c ${q(finalCmd)}`,
          timeout: timeoutSeconds,
        },
      })
    );

    if (!resp.stream)
      throw new Error("No stream in InvokeAgentRuntimeCommand response");
    return consumeCommandStream(resp.stream);
  }

  async destroy(): Promise<void> {
    try {
      await this.client.send(
        new StopRuntimeSessionCommand({
          agentRuntimeArn: this.agentRuntimeArn,
          runtimeSessionId: this.id,
          qualifier: this.qualifier,
        })
      );
    } catch {
      // Already stopped or expired — nothing to do.
    }
  }
}

// ============================================================================
// BedrockRuntimeSandboxProvider
// ============================================================================

export class BedrockRuntimeSandboxProvider
  implements
    SandboxProvider<BedrockRuntimeSandboxCreateOptions, BedrockRuntimeSandbox>
{
  readonly id = "bedrock-runtime";
  readonly capabilities: SandboxCapabilities = {
    filesystem: true,
    execution: true,
    persistence: true,
  };

  private client: BedrockAgentCoreClient;
  private readonly agentRuntimeArn: string;
  private readonly defaultQualifier: string | undefined;
  private readonly defaultWorkspaceBase: string;
  private readonly defaultCommandTimeoutSeconds: number | undefined;

  constructor(config: BedrockRuntimeSandboxConfig) {
    this.client = new BedrockAgentCoreClient(config.clientConfig ?? {});
    this.agentRuntimeArn = config.agentRuntimeArn;
    this.defaultQualifier = config.qualifier;
    this.defaultWorkspaceBase = config.workspaceBase ?? "/mnt/workspace";
    this.defaultCommandTimeoutSeconds = config.commandTimeoutSeconds;
  }

  async create(
    options?: BedrockRuntimeSandboxCreateOptions
  ): Promise<SandboxCreateResult> {
    const sessionId = makeSessionId(options?.id);
    const qualifier = options?.qualifier ?? this.defaultQualifier;
    const workspaceBase = options?.workspaceBase ?? this.defaultWorkspaceBase;
    const commandTimeoutSeconds =
      options?.commandTimeoutSeconds ?? this.defaultCommandTimeoutSeconds;

    const sandbox = new BedrockRuntimeSandboxImpl(
      sessionId,
      this.client,
      this.agentRuntimeArn,
      qualifier,
      commandTimeoutSeconds,
      workspaceBase
    );

    if (options?.initialFiles) {
      for (const [path, content] of Object.entries(options.initialFiles)) {
        await sandbox.fs.writeFile(path, content);
      }
    }

    return { sandbox };
  }

  async get(sandboxId: string): Promise<BedrockRuntimeSandbox> {
    // AgentCore Runtime does not expose a Get-session API on the data plane.
    // The session is whatever the caller is holding the id for; we return a
    // fresh handle bound to the same id and trust subsequent invokes to
    // surface any "session not found" errors.
    return new BedrockRuntimeSandboxImpl(
      sandboxId,
      this.client,
      this.agentRuntimeArn,
      this.defaultQualifier,
      this.defaultCommandTimeoutSeconds,
      this.defaultWorkspaceBase
    );
  }

  async destroy(sandboxId: string): Promise<void> {
    try {
      await this.client.send(
        new StopRuntimeSessionCommand({
          agentRuntimeArn: this.agentRuntimeArn,
          runtimeSessionId: sandboxId,
          qualifier: this.defaultQualifier,
        })
      );
    } catch {
      // Already stopped or expired.
    }
  }

  async pause(sandboxId: string, _ttlSeconds?: number): Promise<void> {
    // AgentCore Runtime "pause" is the same call as "stop" — compute is
    // terminated, but the runtimeSessionId and any persistent filesystem
    // (if `filesystemConfigurations.sessionStorage` is enabled on the
    // runtime resource) are kept. The session reactivates on the next
    // invoke with the same id.
    await this.client.send(
      new StopRuntimeSessionCommand({
        agentRuntimeArn: this.agentRuntimeArn,
        runtimeSessionId: sandboxId,
        qualifier: this.defaultQualifier,
      })
    );
  }

  async resume(_sandboxId: string): Promise<void> {
    // Resume is implicit: the next InvokeAgentRuntime / InvokeAgentRuntime-
    // Command call with the same runtimeSessionId provisions fresh compute
    // and rehydrates persistent filesystem state.
  }

  async snapshot(
    _sandboxId: string,
    _options?: BedrockRuntimeSandboxCreateOptions
  ): Promise<SandboxSnapshot> {
    throw new SandboxNotSupportedError("snapshot");
  }

  async restore(
    _snapshot: SandboxSnapshot,
    _options?: BedrockRuntimeSandboxCreateOptions
  ): Promise<never> {
    throw new SandboxNotSupportedError("restore");
  }

  async deleteSnapshot(_snapshot: SandboxSnapshot): Promise<void> {
    throw new SandboxNotSupportedError("deleteSnapshot");
  }

  async fork(
    _sandboxId: string,
    _options?: BedrockRuntimeSandboxCreateOptions
  ): Promise<Sandbox> {
    throw new SandboxNotSupportedError("fork");
  }
}

// Re-exports
export { BedrockRuntimeSandboxFileSystem } from "./filesystem";
export type {
  BedrockRuntimeSandbox,
  BedrockRuntimeSandboxConfig,
  BedrockRuntimeSandboxCreateOptions,
} from "./types";
