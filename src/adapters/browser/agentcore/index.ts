import {
  BedrockAgentCoreClient,
  GetBrowserSessionCommand,
  ResourceNotFoundException,
  StartBrowserSessionCommand,
  StopBrowserSessionCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { SignatureV4 } from "@aws-sdk/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";
import type { AwsCredentialIdentity, HttpRequest, Provider } from "@aws-sdk/types";
import type {
  BrowserConnection,
  BrowserSession,
  BrowserSessionCreateResult,
  BrowserSessionProvider,
} from "../../../lib/browser/types";
import { ResourceNotFoundError } from "../../../lib/resource/types";
import type {
  AgentCoreBrowserConfig,
  AgentCoreBrowserCreateOptions,
  AgentCoreBrowserSession,
} from "./types";

const DEFAULT_BROWSER_IDENTIFIER = "aws.browser.v1";

/**
 * Builds the SigV4-signed CDP WebSocket connection for an AgentCore browser
 * session. Signs an HTTP GET against the automation stream endpoint and
 * returns the headers required to authenticate the WebSocket upgrade.
 */
async function signAutomationConnection(args: {
  region: string;
  browserIdentifier: string;
  sessionId: string;
  credentials: AwsCredentialIdentity | Provider<AwsCredentialIdentity>;
}): Promise<BrowserConnection> {
  const host = `bedrock-agentcore.${args.region}.amazonaws.com`;
  const path = `/browser-streams/${args.browserIdentifier}/sessions/${args.sessionId}/automation`;
  const url = `wss://${host}${path}`;

  const signer = new SignatureV4({
    service: "bedrock-agentcore",
    region: args.region,
    credentials: args.credentials,
    sha256: Sha256,
  });

  const request: HttpRequest = {
    method: "GET",
    protocol: "wss:",
    hostname: host,
    path,
    headers: { host },
    query: {},
  };

  const signed = await signer.sign(request);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(signed.headers)) {
    if (typeof value === "string") headers[key] = value;
  }
  return { url, headers };
}

// ============================================================================
// AgentCoreBrowserSession
// ============================================================================

class AgentCoreBrowserSessionImpl implements BrowserSession {
  constructor(
    readonly id: string,
    private readonly client: BedrockAgentCoreClient,
    private readonly region: string,
    private readonly browserIdentifier: string
  ) {}

  async getConnection(): Promise<BrowserConnection> {
    return signAutomationConnection({
      region: this.region,
      browserIdentifier: this.browserIdentifier,
      sessionId: this.id,
      credentials: this.client.config.credentials,
    });
  }

  async destroy(): Promise<void> {
    try {
      await this.client.send(
        new StopBrowserSessionCommand({
          browserIdentifier: this.browserIdentifier,
          sessionId: this.id,
        })
      );
    } catch (err) {
      if (!(err instanceof ResourceNotFoundException)) throw err;
      // Already stopped / reclaimed — destroy is idempotent.
    }
  }
}

// ============================================================================
// AgentCoreBrowserProvider
// ============================================================================

/**
 * AWS Bedrock AgentCore Browser provider. Minimal-cap: only base
 * `create`/`get`/`destroy`. AgentCore browser sessions cannot be paused,
 * resumed, snapshotted, or forked, so `supportedCapabilities` is empty.
 *
 * Requires the optional peer dependencies `@aws-sdk/client-bedrock-agentcore`,
 * `@aws-sdk/signature-v4`, and `@aws-crypto/sha256-js`.
 *
 * @example
 * ```typescript
 * import { AgentCoreBrowserProvider } from "zeitlich/adapters/browser/agentcore";
 * import { BrowserSessionManager } from "zeitlich";
 *
 * const provider = new AgentCoreBrowserProvider({ region: "us-west-2" });
 * const manager = new BrowserSessionManager(provider);
 * ```
 */
export class AgentCoreBrowserProvider
  implements
    BrowserSessionProvider<
      AgentCoreBrowserCreateOptions,
      AgentCoreBrowserSession
    >
{
  readonly id = "agentcoreBrowser";
  readonly supportedCapabilities: ReadonlySet<never> = new Set<never>();

  private readonly client: BedrockAgentCoreClient;
  private readonly region: string;
  private readonly defaultBrowserIdentifier: string;
  private readonly defaultSessionTimeoutSeconds?: number;

  constructor(config: AgentCoreBrowserConfig) {
    this.region = config.region;
    this.defaultBrowserIdentifier =
      config.browserIdentifier ?? DEFAULT_BROWSER_IDENTIFIER;
    this.defaultSessionTimeoutSeconds = config.sessionTimeoutSeconds;
    this.client = new BedrockAgentCoreClient({
      region: config.region,
      ...(config.credentials && { credentials: config.credentials }),
      ...(config.endpoint && { endpoint: config.endpoint }),
    });
  }

  async create(
    options?: AgentCoreBrowserCreateOptions
  ): Promise<BrowserSessionCreateResult> {
    const browserIdentifier =
      options?.browserIdentifier ?? this.defaultBrowserIdentifier;
    const sessionTimeoutSeconds =
      options?.sessionTimeoutSeconds ?? this.defaultSessionTimeoutSeconds;

    const response = await this.client.send(
      new StartBrowserSessionCommand({
        browserIdentifier,
        ...(options?.name && { name: options.name }),
        ...(sessionTimeoutSeconds !== undefined && { sessionTimeoutSeconds }),
      })
    );

    if (!response.sessionId) {
      throw new Error("AgentCore StartBrowserSession returned no sessionId");
    }

    const session = new AgentCoreBrowserSessionImpl(
      response.sessionId,
      this.client,
      this.region,
      browserIdentifier
    );
    return { session };
  }

  async get(sessionId: string): Promise<AgentCoreBrowserSession> {
    try {
      await this.client.send(
        new GetBrowserSessionCommand({
          browserIdentifier: this.defaultBrowserIdentifier,
          sessionId,
        })
      );
    } catch (err) {
      if (err instanceof ResourceNotFoundException) {
        throw new ResourceNotFoundError(sessionId);
      }
      throw err;
    }
    return new AgentCoreBrowserSessionImpl(
      sessionId,
      this.client,
      this.region,
      this.defaultBrowserIdentifier
    );
  }

  async destroy(sessionId: string): Promise<void> {
    try {
      await this.client.send(
        new StopBrowserSessionCommand({
          browserIdentifier: this.defaultBrowserIdentifier,
          sessionId,
        })
      );
    } catch (err) {
      if (!(err instanceof ResourceNotFoundException)) throw err;
      // Already stopped / reclaimed — destroy is idempotent.
    }
  }
}

// Re-exports
export type {
  AgentCoreBrowserConfig,
  AgentCoreBrowserCreateOptions,
  AgentCoreBrowserSession,
} from "./types";
