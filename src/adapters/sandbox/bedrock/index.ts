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
  SandboxCapability,
  SandboxCreateResult,
  SandboxProvider,
  ExecOptions,
  ExecResult,
} from "../../../lib/sandbox/types";
import { SandboxNotFoundError } from "../../../lib/sandbox/types";
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
    let cmd = command;
    if (options?.cwd) cmd = `cd "${options.cwd}" && ${cmd}`;
    if (options?.env) {
      const exports = Object.entries(options.env)
        .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
        .join(" && ");
      cmd = `${exports} && ${cmd}`;
    }

    const resp = await this.client.send(
      new InvokeCodeInterpreterCommand({
        codeInterpreterIdentifier: this.codeInterpreterIdentifier,
        sessionId: this.sessionId,
        name: "executeCommand",
        arguments: { command: cmd },
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

/**
 * Single source of truth for the Bedrock Code Interpreter adapter's
 * capability set. The Code Interpreter only exposes base lifecycle
 * (`create` / `get` / `destroy`); both the type-level `TCaps` (`never`)
 * and the runtime `supportedCapabilities` set fall out of this empty
 * array, so the two surfaces cannot drift.
 */
const BEDROCK_CAPS = [] as const satisfies readonly SandboxCapability[];
type BedrockCaps = (typeof BEDROCK_CAPS)[number]; // → never

/**
 * Bedrock Code Interpreter implements only base sandbox lifecycle
 * (`create` / `get` / `destroy`). Snapshot, restore, fork, pause, and
 * resume are not supported — the type-level capability set is `never`, so
 * calling any of those methods on a Bedrock provider, manager, or
 * `SandboxOps` proxy is a compile-time TypeScript error.
 */
export class BedrockSandboxProvider
  implements
    SandboxProvider<BedrockSandboxCreateOptions, BedrockSandbox, BedrockCaps>
{
  readonly id = "bedrock";
  readonly capabilities: SandboxCapabilities = {
    filesystem: true,
    execution: true,
    persistence: false,
  };
  readonly supportedCapabilities: ReadonlySet<BedrockCaps> = new Set(
    BEDROCK_CAPS
  );

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
        .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
        .join(" ");
      await sandbox.exec(`echo '${exports}' >> ~/.bashrc`);
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
}

// Re-exports
export { BedrockSandboxFileSystem } from "./filesystem";
export type {
  BedrockSandbox,
  BedrockSandboxConfig,
  BedrockSandboxCreateOptions,
} from "./types";
