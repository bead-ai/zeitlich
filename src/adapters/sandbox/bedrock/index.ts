import {
  BedrockAgentCoreClient,
  StartCodeInterpreterSessionCommand,
  GetCodeInterpreterSessionCommand,
  StopCodeInterpreterSessionCommand,
  InvokeCodeInterpreterCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import type { CodeInterpreterStreamOutput } from "@aws-sdk/client-bedrock-agentcore";
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
import { BedrockSandboxFileSystem } from "./filesystem";
import type {
  BedrockSandbox,
  BedrockSandboxConfig,
  BedrockSandboxCreateOptions,
} from "./types";

// ============================================================================
// Stream helpers
// ============================================================================

async function consumeExecStream(
  stream: AsyncIterable<CodeInterpreterStreamOutput>
): Promise<ExecResult> {
  for await (const event of stream) {
    if ("result" in event && event.result) {
      const sc = event.result.structuredContent;
      return {
        exitCode: sc?.exitCode ?? 0,
        stdout: sc?.stdout ?? "",
        stderr: sc?.stderr ?? "",
      };
    }
    if ("accessDeniedException" in event && event.accessDeniedException)
      throw new Error(event.accessDeniedException.message ?? "Access denied");
    if ("resourceNotFoundException" in event && event.resourceNotFoundException)
      throw new Error(
        event.resourceNotFoundException.message ?? "Resource not found"
      );
    if ("validationException" in event && event.validationException)
      throw new Error(event.validationException.message ?? "Validation error");
    if ("internalServerException" in event && event.internalServerException)
      throw new Error(
        event.internalServerException.message ?? "Internal server error"
      );
    if ("throttlingException" in event && event.throttlingException)
      throw new Error(event.throttlingException.message ?? "Throttled");
    if (
      "serviceQuotaExceededException" in event &&
      event.serviceQuotaExceededException
    )
      throw new Error(
        event.serviceQuotaExceededException.message ?? "Quota exceeded"
      );
    if ("conflictException" in event && event.conflictException)
      throw new Error(event.conflictException.message ?? "Conflict");
  }
  return { exitCode: 0, stdout: "", stderr: "" };
}

// ============================================================================
// BedrockSandboxImpl
// ============================================================================

class BedrockSandboxImpl implements Sandbox {
  readonly capabilities: SandboxCapabilities = {
    filesystem: true,
    execution: true,
    persistence: false,
  };

  readonly fs: BedrockSandboxFileSystem;

  constructor(
    readonly id: string,
    private client: BedrockAgentCoreClient,
    private codeInterpreterIdentifier: string,
    private sessionId: string,
    workspaceBase = "/home/user"
  ) {
    this.fs = new BedrockSandboxFileSystem(
      client,
      codeInterpreterIdentifier,
      sessionId,
      workspaceBase
    );
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    const finalCmd = sh.withCwdAndEnv(command, {
      cwd: options?.cwd,
      env: options?.env,
    });

    const resp = await this.client.send(
      new InvokeCodeInterpreterCommand({
        codeInterpreterIdentifier: this.codeInterpreterIdentifier,
        sessionId: this.sessionId,
        name: "executeCommand",
        arguments: { command: finalCmd },
      })
    );

    if (!resp.stream) throw new Error("No stream in code interpreter response");
    return consumeExecStream(resp.stream);
  }

  async destroy(): Promise<void> {
    await this.client.send(
      new StopCodeInterpreterSessionCommand({
        codeInterpreterIdentifier: this.codeInterpreterIdentifier,
        sessionId: this.sessionId,
      })
    );
  }
}

// ============================================================================
// BedrockSandboxProvider
// ============================================================================

export class BedrockSandboxProvider implements SandboxProvider<
  BedrockSandboxCreateOptions,
  BedrockSandbox
> {
  readonly id = "bedrock";
  readonly capabilities: SandboxCapabilities = {
    filesystem: true,
    execution: true,
    persistence: false,
  };

  private client: BedrockAgentCoreClient;
  private readonly codeInterpreterIdentifier: string;
  private readonly defaultWorkspaceBase: string;

  constructor(config: BedrockSandboxConfig) {
    this.client = new BedrockAgentCoreClient(config.clientConfig ?? {});
    this.codeInterpreterIdentifier = config.codeInterpreterIdentifier;
    this.defaultWorkspaceBase = config.workspaceBase ?? "/home/user";
  }

  async create(
    options?: BedrockSandboxCreateOptions
  ): Promise<SandboxCreateResult> {
    const resp = await this.client.send(
      new StartCodeInterpreterSessionCommand({
        codeInterpreterIdentifier: this.codeInterpreterIdentifier,
        name: options?.name,
        sessionTimeoutSeconds: options?.sessionTimeoutSeconds,
      })
    );

    const sessionId = resp.sessionId ?? "";
    if (!sessionId) throw new Error("No sessionId returned from Bedrock");
    const sandbox = new BedrockSandboxImpl(
      sessionId,
      this.client,
      this.codeInterpreterIdentifier,
      sessionId,
      this.defaultWorkspaceBase
    );

    if (options?.initialFiles) {
      for (const [path, content] of Object.entries(options.initialFiles)) {
        await sandbox.fs.writeFile(path, content);
      }
    }

    if (options?.env) {
      const exports = Object.entries(options.env)
        .map(([k, v]) => `${k}=${q(v)}`)
        .join(" ");
      await sandbox.exec(`echo ${q(exports)} >> ~/.bashrc`);
    }

    return { sandbox };
  }

  async get(sandboxId: string): Promise<BedrockSandbox> {
    try {
      const resp = await this.client.send(
        new GetCodeInterpreterSessionCommand({
          codeInterpreterIdentifier: this.codeInterpreterIdentifier,
          sessionId: sandboxId,
        })
      );

      if (resp.status === "TERMINATED") {
        throw new SandboxNotFoundError(sandboxId);
      }

      return new BedrockSandboxImpl(
        sandboxId,
        this.client,
        this.codeInterpreterIdentifier,
        sandboxId,
        this.defaultWorkspaceBase
      );
    } catch (err) {
      if (err instanceof SandboxNotFoundError) throw err;
      throw new SandboxNotFoundError(sandboxId);
    }
  }

  async destroy(sandboxId: string): Promise<void> {
    try {
      await this.client.send(
        new StopCodeInterpreterSessionCommand({
          codeInterpreterIdentifier: this.codeInterpreterIdentifier,
          sessionId: sandboxId,
        })
      );
    } catch {
      // Already stopped or not found
    }
  }

  async pause(_sandboxId: string, _ttlSeconds?: number): Promise<void> {
    throw new SandboxNotSupportedError("pause");
  }

  async resume(_sandboxId: string): Promise<void> {
    // Bedrock sandboxes don't support pause, so resume is a no-op
  }

  async snapshot(
    _sandboxId: string,
    _options?: BedrockSandboxCreateOptions
  ): Promise<SandboxSnapshot> {
    throw new SandboxNotSupportedError("snapshot");
  }

  async restore(
    _snapshot: SandboxSnapshot,
    _options?: BedrockSandboxCreateOptions
  ): Promise<never> {
    throw new SandboxNotSupportedError("restore");
  }

  async fork(
    _sandboxId: string,
    _options?: BedrockSandboxCreateOptions
  ): Promise<Sandbox> {
    throw new SandboxNotSupportedError("fork");
  }

  async deleteSnapshot(_snapshot: SandboxSnapshot): Promise<void> {
    throw new SandboxNotSupportedError("deleteSnapshot");
  }
}

// Re-exports
export { BedrockSandboxFileSystem } from "./filesystem";
export type {
  BedrockSandbox,
  BedrockSandboxConfig,
  BedrockSandboxCreateOptions,
} from "./types";
