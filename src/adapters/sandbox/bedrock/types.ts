import type { Sandbox, SandboxCreateOptions } from "../../../lib/sandbox/types";
import type { BedrockSandboxFileSystem } from "./filesystem";
import type { BedrockAgentCoreClientConfig } from "@aws-sdk/client-bedrock-agentcore";

/**
 * A Bedrock-backed {@link Sandbox} with its typed filesystem.
 */
export type BedrockSandbox = Sandbox & { fs: BedrockSandboxFileSystem };

export interface BedrockSandboxConfig {
  /** ARN or name of the Code Interpreter resource. */
  codeInterpreterIdentifier: string;
  /** AWS SDK client configuration (region, credentials, etc.). */
  clientConfig?: BedrockAgentCoreClientConfig;
  /** Default base path for resolving relative filesystem paths. */
  workspaceBase?: string;
}

export interface BedrockSandboxCreateOptions extends SandboxCreateOptions {
  /** Session name (human-readable, does not need to be unique). */
  name?: string;
  /** Session timeout in seconds. Default 900 (15 min). Max 28 800 (8 h). */
  sessionTimeoutSeconds?: number;
}
