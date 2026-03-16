import type { Sandbox, SandboxCreateOptions } from "../../../lib/sandbox/types";
import type { E2bSandboxFileSystem } from "./filesystem";

/**
 * An E2B-backed {@link Sandbox} with its typed filesystem.
 */
export type E2bSandbox = Sandbox & { fs: E2bSandboxFileSystem };

export interface E2bSandboxConfig {
  /** E2B API key — defaults to the `E2B_API_KEY` environment variable */
  apiKey?: string;
  /** Sandbox template name or ID */
  template?: string;
  /** Default working directory inside the sandbox */
  workspaceBase?: string;
  /** Sandbox idle timeout in milliseconds */
  timeoutMs?: number;
}

export interface E2bSandboxCreateOptions extends SandboxCreateOptions {
  /** Sandbox template name or ID — overrides the provider default */
  template?: string;
  /** Sandbox idle timeout in milliseconds — overrides the provider default */
  timeoutMs?: number;
}
