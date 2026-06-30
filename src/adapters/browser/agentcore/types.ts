import type { AwsCredentialIdentity, Provider } from "@aws-sdk/types";
import type { BrowserCreateOptions, BrowserSession } from "../../../lib/browser/types";

/**
 * Static configuration for {@link import("./index").AgentCoreBrowserProvider}.
 */
export interface AgentCoreBrowserConfig {
  /** AWS region hosting the AgentCore browser (e.g. `"us-west-2"`). */
  region: string;
  /**
   * Browser identifier to launch sessions against. Defaults to the AWS-managed
   * browser `"aws.browser.v1"`. Pass a custom browser id for advanced features
   * (session recording, custom network, IAM role).
   */
  browserIdentifier?: string;
  /** Default session lifetime in seconds (provider default 900s / max 28800s). */
  sessionTimeoutSeconds?: number;
  /**
   * Optional explicit credentials. When omitted the AgentCore client resolves
   * credentials from the default AWS provider chain.
   */
  credentials?: AwsCredentialIdentity | Provider<AwsCredentialIdentity>;
  /** Optional custom endpoint override for the AgentCore data-plane client. */
  endpoint?: string;
}

/**
 * Per-call options for creating an AgentCore browser session. Extends the
 * generic {@link BrowserCreateOptions} with a per-session browser override.
 */
export interface AgentCoreBrowserCreateOptions extends BrowserCreateOptions {
  /** Override the provider's default `browserIdentifier` for this session. */
  browserIdentifier?: string;
}

/**
 * AgentCore-specific {@link BrowserSession}. Currently identical to the base
 * interface; declared as a named alias so handlers can opt into the concrete
 * type via `BrowserSessionManager<AgentCoreBrowserSession>`.
 */
export type AgentCoreBrowserSession = BrowserSession;
