/**
 * Bedrock AgentCore Runtime sandbox adapter.
 *
 * AgentCore is a GA AWS service (announced October 2025), so the SDK
 * shapes used here — `BedrockAgentCoreClient`, `InvokeAgentRuntimeCommand`,
 * `StopRuntimeSession` — are covered by AWS's standard API stability
 * promise: additive changes only, no breaking renames.
 *
 * @see https://aws.amazon.com/about-aws/whats-new/2025/10/amazon-bedrock-agentcore-available/
 *      AgentCore GA announcement
 * @see https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html
 *      AgentCore service overview
 */

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
import {
  SandboxNotFoundError,
  SandboxNotSupportedError,
} from "../../../lib/sandbox/types";
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
 * The caller's id is honoured if it qualifies; otherwise we generate a fresh
 * one prefixed with `zeitlich-` and a UUID with hyphens stripped (32 chars).
 *
 * @see https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html
 *      "How to use sessions" — *"Generate a unique session ID for each user
 *      or conversation with at least 33 characters"*
 */
const SESSION_ID_MIN_LENGTH = 33;

function makeSessionId(preferred?: string): string {
  if (preferred && preferred.length >= SESSION_ID_MIN_LENGTH) return preferred;
  const uuid = randomUUID().replace(/-/g, "");
  return preferred ? `${preferred}-${uuid}`.slice(0, 64) : `zeitlich-${uuid}`;
}

/**
 * Path (relative to `workspaceBase`) of the marker file we write on
 * `create()` and check for on `get()` when `strictGet` is on. Lets the
 * adapter distinguish a session it provisioned from one AgentCore would
 * otherwise mint implicitly on first invoke.
 */
const SESSION_MARKER_PATH = ".zeitlich-agentcore-runtime/created_at";

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
    // See https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-persistent-filesystems.html#configure-session-storage
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

  /**
   * Internal: write the session-creation marker into the runtime's
   * filesystem. Called from {@link BedrockRuntimeSandboxProvider.create}.
   * Idempotent — overwrites the existing marker if one is somehow there.
   */
  async writeSessionMarker(): Promise<void> {
    await this.fs.writeFile(SESSION_MARKER_PATH, new Date().toISOString());
  }

  /**
   * Internal: probe for the session-creation marker. Used by
   * {@link BedrockRuntimeSandboxProvider.get} when `strictGet` is on.
   *
   * IMPORTANT: this exec implicitly creates the session if AgentCore
   * doesn't know it yet (that's the very behaviour `strictGet` exists to
   * detect). Callers that find the marker absent should `destroy()` this
   * sandbox before propagating the error.
   */
  async hasSessionMarker(): Promise<boolean> {
    return this.fs.exists(SESSION_MARKER_PATH);
  }
}

// ============================================================================
// BedrockRuntimeSandboxProvider
// ============================================================================

export class BedrockRuntimeSandboxProvider
  implements
    SandboxProvider<BedrockRuntimeSandboxCreateOptions, BedrockRuntimeSandbox>
{
  readonly id = "bedrockRuntime";
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
  private readonly strictGet: boolean;

  constructor(config: BedrockRuntimeSandboxConfig) {
    this.client = new BedrockAgentCoreClient(config.clientConfig ?? {});
    this.agentRuntimeArn = config.agentRuntimeArn;
    this.defaultQualifier = config.qualifier;
    this.defaultWorkspaceBase = config.workspaceBase ?? "/mnt/workspace";
    this.defaultCommandTimeoutSeconds = config.commandTimeoutSeconds;
    this.strictGet = config.strictGet ?? false;
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

    // Only write the marker when strictGet is on — saves a round-trip
    // per create() when the protection isn't being used (the default).
    if (this.strictGet) {
      await sandbox.writeSessionMarker();
    }

    return { sandbox };
  }

  async get(sandboxId: string): Promise<BedrockRuntimeSandbox> {
    // AgentCore Runtime has no GetRuntimeSession data-plane API in the
    // bedrock-agentcore SDK — sessions are referenced purely by the
    // (agentRuntimeArn, runtimeSessionId) pair the caller already holds,
    // and AgentCore mints sessions from caller-supplied ids on first
    // invoke with no "session not found" error path. By default this
    // method just returns a thin handle bound to the supplied id; the
    // first exec/fs call against it either reattaches to an existing
    // session or implicitly mints a fresh one (AgentCore's choice, the
    // adapter cannot tell the two apart from outside).
    //
    // Pass `strictGet: true` on the provider to opt into a marker-based
    // probe: `create()` writes a marker file, `get()` checks for it,
    // and missing markers throw SandboxNotFoundError instead of silently
    // returning a fresh empty sandbox. Worth turning on when session
    // ids flow through Temporal payloads or external state where typo
    // or id-collision bugs would otherwise corrupt unrelated sandboxes.
    //
    // See https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html#session-lifecycle
    const sandbox = new BedrockRuntimeSandboxImpl(
      sandboxId,
      this.client,
      this.agentRuntimeArn,
      this.defaultQualifier,
      this.defaultCommandTimeoutSeconds,
      this.defaultWorkspaceBase
    );

    if (this.strictGet && !(await sandbox.hasSessionMarker())) {
      // The marker probe just minted a fresh session — clean it up
      // before bubbling the error so we don't leak compute.
      try {
        await sandbox.destroy();
      } catch {
        /* best-effort */
      }
      throw new SandboxNotFoundError(sandboxId);
    }

    return sandbox;
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
    // invoke with the same id, with a fresh microVM and the same lifecycle
    // configuration. Sessions are GC'd after 14 days idle.
    //
    // See:
    //   https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-stop-session.html
    //     — instant termination of compute on Stop
    //   https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html#session-lifecycle
    //     — "transitions back to Active on the next invocation"
    //   https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-persistent-filesystems.html#session-storage-data-lifecycle
    //     — 14-day idle GC of session-storage data
    try {
      await this.client.send(
        new StopRuntimeSessionCommand({
          agentRuntimeArn: this.agentRuntimeArn,
          runtimeSessionId: sandboxId,
          qualifier: this.defaultQualifier,
        })
      );
    } catch (err) {
      // Idempotent: if the session is already stopped or expired, the
      // end state pause() promises ("compute is not running") is already
      // satisfied. Treat as success. Without this, Temporal-style activity
      // retries fail when the first attempt's StopRuntimeSession succeeded
      // but the response was lost in transit.
      if (err instanceof Error && err.name === "ResourceNotFoundException") {
        return;
      }
      throw err;
    }
  }

  async resume(_sandboxId: string): Promise<void> {
    // Resume is implicit: the next InvokeAgentRuntime / InvokeAgentRuntime-
    // Command call with the same runtimeSessionId provisions fresh compute
    // and rehydrates persistent filesystem state.
    //
    // See https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html#session-lifecycle
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
