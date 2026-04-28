import type { Sandbox, SandboxCreateOptions } from "../../../lib/sandbox/types";
import type { BedrockRuntimeSandboxFileSystem } from "./filesystem";
import type { BedrockAgentCoreClientConfig } from "@aws-sdk/client-bedrock-agentcore";

/**
 * A Bedrock-AgentCore-Runtime-backed {@link Sandbox} with its typed filesystem.
 */
export type BedrockRuntimeSandbox = Sandbox & {
  fs: BedrockRuntimeSandboxFileSystem;
};

export interface BedrockRuntimeSandboxConfig {
  /**
   * ARN of the AgentCore Runtime resource that hosts the sandbox container.
   * Created out-of-band via the `bedrock-agentcore-control` API
   * (`CreateAgentRuntime`) — this adapter only manages sessions, not the
   * runtime resource itself.
   */
  agentRuntimeArn: string;
  /**
   * Endpoint qualifier (e.g. `"DEFAULT"`, `"prod"`). Defaults to `DEFAULT`
   * server-side when omitted.
   */
  qualifier?: string;
  /** AWS SDK client configuration (region, credentials, etc.). */
  clientConfig?: BedrockAgentCoreClientConfig;
  /**
   * Default base path for resolving relative filesystem paths. Should match
   * the `mountPath` of any `sessionStorage` filesystem configured on the
   * runtime; defaults to `/mnt/workspace` (the AgentCore convention).
   */
  workspaceBase?: string;
  /**
   * Default per-command timeout in seconds. Each call to
   * `InvokeAgentRuntimeCommand` runs a fresh `bash -c` process; this is the
   * upper bound on its wall-clock time. Server-side default if omitted.
   */
  commandTimeoutSeconds?: number;
  /**
   * Reject `provider.get(id)` calls for sessions this adapter never
   * created. Defaults to `true`.
   *
   * When enabled, `get()` checks for a marker file in the runtime's
   * filesystem; if absent, it destroys the freshly-minted session and
   * throws {@link SandboxNotFoundError} — preventing AgentCore's
   * implicit-create behaviour from silently handing you an empty session.
   *
   * The protection only spans Stop+resume cycles if the runtime has
   * `filesystemConfigurations.sessionStorage` configured. Without
   * persistence, `get()` after a pause/idle-timeout will throw, since the
   * marker is gone with the previous microVM. That's accurate semantically
   * (the session state was lost) but worth knowing.
   */
  strictGet?: boolean;
}

export interface BedrockRuntimeSandboxCreateOptions extends SandboxCreateOptions {
  /** Override the default qualifier for this sandbox. */
  qualifier?: string;
  /** Override the default per-command timeout. */
  commandTimeoutSeconds?: number;
  /** Override the workspace base path for this sandbox. */
  workspaceBase?: string;
}
