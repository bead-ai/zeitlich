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
   * Opt-in defence against AgentCore's implicit-create-on-first-invoke
   * behaviour. Defaults to `false` (off).
   *
   * When `true`, `provider.create()` writes a marker file under
   * `${workspaceBase}/.zeitlich-agentcore-runtime/created_at`, and
   * `provider.get(id)` checks for it. If the marker is absent, `get()`
   * destroys the freshly-minted session and throws
   * {@link SandboxNotFoundError} instead of silently returning a new
   * empty sandbox under whatever id you happened to pass.
   *
   * Why this is opt-in:
   * - The marker file lives in the runtime filesystem, so it only
   *   survives Stop+resume cycles when the runtime has
   *   `filesystemConfigurations.sessionStorage` configured. Without
   *   persistent FS, the marker dies on every microVM recycle and
   *   `get()` after a pause/idle-timeout throws even on legitimate ids.
   * - The probe costs an extra round-trip on every `create()` (write
   *   marker) and every `get()` (read marker), ~150–300 ms each.
   * - For codebases where the session id flows through a single,
   *   well-typed path from `create()` to `get()`, the protection
   *   rarely fires; relying on AgentCore's native
   *   "implicit-create-on-unknown-id" semantics is simpler.
   *
   * Turn it on if your call sites shuffle session ids through Temporal
   * payloads, external state, or multi-worker coordination where a
   * typo or id collision could silently hand you the wrong sandbox.
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
