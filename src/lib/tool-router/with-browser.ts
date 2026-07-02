import type { BrowserSession } from "../browser/types";
import { ResourceNotFoundError } from "../resource/types";
import type { JsonValue } from "../state/types";
import type { ActivityToolHandler, RouterContext } from "./types";

/**
 * Options for {@link withBrowser}.
 */
export interface WithBrowserOptions {
  /**
   * If `true`, a {@link ResourceNotFoundError} thrown by
   * `manager.getBrowserSession` is translated into a structured tool-handler
   * response (instead of propagating). This lets the agent return a graceful
   * error to the model rather than crashing the workflow when the backing
   * browser session has expired (e.g. the provider's session timeout elapsed).
   *
   * @default false
   */
  translateSessionNotFound?: boolean;
  /**
   * Custom tool response returned to the agent when the backing browser
   * session is not found and `translateSessionNotFound` is `true`.
   */
  sessionNotFoundToolResponse?: string;
}

/**
 * Extended router context with a resolved {@link BrowserSession} instance.
 */
export interface BrowserContext<TSession extends BrowserSession = BrowserSession>
  extends RouterContext {
  browserSession: TSession;
  browserSessionId: string;
}

/**
 * Wraps a tool handler that requires a {@link BrowserSession}, automatically
 * resolving it from the manager via the `browserSessionId` on the router
 * context. Sibling of `withSandbox`.
 *
 * If no `browserSessionId` is present the wrapper short-circuits with an error
 * response and `data: null`, so the inner handler never runs without a valid
 * session.
 *
 * @param manager - Any object with a `getBrowserSession` method (e.g. {@link import("../browser/manager").BrowserSessionManager})
 * @param handler - The inner handler that expects a browser context
 *
 * @example
 * ```typescript
 * import { withBrowser, type BrowserContext } from 'zeitlich';
 *
 * const navigateHandler: ActivityToolHandler<NavArgs, void, BrowserContext> =
 *   async (args, { browserSession }) => {
 *     const { url, headers } = await browserSession.getConnection();
 *     const browser = await chromium.connectOverCDP(url, { headers });
 *     // ... drive the page ...
 *     return { toolResponse: 'ok', data: null };
 *   };
 * const handler = withBrowser(manager, navigateHandler);
 * ```
 */
export function withBrowser<
  TArgs,
  TResult,
  TSession extends BrowserSession = BrowserSession,
  TToolResponse = JsonValue,
>(
  manager: { getBrowserSession(id: string): Promise<TSession> },
  handler: ActivityToolHandler<
    TArgs,
    TResult,
    BrowserContext<TSession>,
    TToolResponse
  >,
  options?: WithBrowserOptions
): ActivityToolHandler<
  TArgs,
  TResult | null,
  RouterContext,
  TToolResponse | string
> {
  const translateSessionNotFound = options?.translateSessionNotFound ?? false;
  return async (args, context) => {
    if (!context.browserSessionId) {
      return {
        toolResponse: `Error: No browser session configured for this agent. The ${context.toolName} tool requires a browser session.`,
        data: null,
      };
    }
    let session: TSession;
    try {
      session = await manager.getBrowserSession(context.browserSessionId);
    } catch (err) {
      if (translateSessionNotFound && err instanceof ResourceNotFoundError) {
        return {
          toolResponse:
            options?.sessionNotFoundToolResponse ??
            `Error: the browser session for the ${context.toolName} tool is no longer available, so this tool call could not be completed.`,
          data: null,
        };
      }
      throw err;
    }
    return handler(args, {
      ...context,
      browserSession: session,
      browserSessionId: context.browserSessionId,
    });
  };
}
