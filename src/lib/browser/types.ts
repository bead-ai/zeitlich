// ============================================================================
// Browser session types
//
// A browser session is a second specialization of the generic managed-resource
// core in `src/lib/resource` (the first being the sandbox). It reuses the
// control-plane (create/destroy lifecycle, Temporal activity proxying, session
// init/shutdown) but has a different data-plane: instead of a filesystem and
// shell `exec`, it exposes a remote CDP/WebSocket endpoint that the caller
// drives with their own Playwright/Puppeteer.
//
// The current providers (AWS Bedrock AgentCore Browser) only support the base
// `create`/`destroy` lifecycle — there is no pause/resume/snapshot/fork — so
// `BrowserSessionOps`/`BrowserSessionProvider` are intentionally minimal-cap.
// Capabilities can be layered later following the sandbox pattern.
// ============================================================================

import type {
  ManagedResource,
  ResourceCreateOptions,
} from "../resource/types";

/**
 * Connection details for driving a remote browser over the Chrome DevTools
 * Protocol. Pass straight into a CDP client, e.g. Playwright's
 * `chromium.connectOverCDP(url, { headers })`.
 */
export interface BrowserConnection {
  /** WebSocket (`wss://`) CDP endpoint. */
  url: string;
  /** Headers required to authenticate the WebSocket upgrade (e.g. SigV4). */
  headers: Record<string, string>;
}

/**
 * A live browser session. The data-plane surface is deliberately small: a
 * stable id, a way to obtain a (possibly freshly-signed) CDP connection, and
 * teardown. Driving the browser is the caller's responsibility.
 */
export interface BrowserSession extends ManagedResource {
  readonly id: string;
  /**
   * Returns CDP connection details for this session. Implementations may
   * regenerate short-lived credentials on each call, so callers should fetch
   * a fresh connection rather than cache the result.
   */
  getConnection(): Promise<BrowserConnection>;
  destroy(): Promise<void>;
}

/**
 * Options accepted when creating a browser session. Extends the resource base
 * with browser-specific fields; individual providers add their own (e.g. the
 * AgentCore adapter adds `browserIdentifier`).
 */
export interface BrowserCreateOptions extends ResourceCreateOptions {
  /** Human-readable session name surfaced in provider consoles/logs. */
  name?: string;
  /** Maximum session lifetime in seconds before the provider reclaims it. */
  sessionTimeoutSeconds?: number;
}

// ============================================================================
// Provider
// ============================================================================

export interface BrowserSessionCreateResult {
  session: BrowserSession;
}

/**
 * Provider-side browser-session lifecycle contract. Minimal-cap: only base
 * `create`/`get`/`destroy`. `supportedCapabilities` is always empty for now,
 * kept for symmetry with {@link import("../resource/types").ResourceCapability}
 * and the manager's runtime consistency check.
 */
export interface BrowserSessionProvider<
  TOptions extends BrowserCreateOptions = BrowserCreateOptions,
  TSession extends BrowserSession = BrowserSession,
> {
  readonly id: string;
  readonly supportedCapabilities: ReadonlySet<never>;

  create(options?: TOptions): Promise<BrowserSessionCreateResult>;
  get(sessionId: string): Promise<TSession>;
  destroy(sessionId: string): Promise<void>;
}

// ============================================================================
// BrowserSessionOps — workflow-side activity interface
// ============================================================================

/**
 * Workflow-side counterpart to {@link BrowserSessionProvider}, exposed as a set
 * of Temporal activities and consumed by `createSession`'s `browserOps` field.
 *
 * `TCtx` is an opaque context value forwarded to the provider's `onPreCreate`
 * hook (mirrors `SandboxOps`).
 */
export interface BrowserSessionOps<
  TOptions extends BrowserCreateOptions = BrowserCreateOptions,
  TCtx = unknown,
> {
  createBrowser(
    options?: TOptions,
    ctx?: TCtx
  ): Promise<{ browserSessionId: string } | null>;
  destroyBrowser(browserSessionId: string): Promise<void>;
}

/**
 * Maps {@link BrowserSessionOps} method names to adapter-prefixed names.
 *
 * @example
 * ```typescript
 * type AgentCoreOps = PrefixedBrowserSessionOps<"agentcoreBrowser">;
 * // → { agentcoreBrowserCreateBrowser, agentcoreBrowserDestroyBrowser }
 * ```
 */
export type PrefixedBrowserSessionOps<
  TPrefix extends string,
  TOptions extends BrowserCreateOptions = BrowserCreateOptions,
  TCtx = unknown,
> = {
  [K in keyof BrowserSessionOps<
    TOptions,
    TCtx
  > as `${TPrefix}${Capitalize<K & string>}`]: BrowserSessionOps<
    TOptions,
    TCtx
  >[K];
};
