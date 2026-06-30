import { describe, expect, it } from "vitest";
import { withBrowser } from "./with-browser";
import type { RouterContext, ToolHandlerResponse } from "./types";
import type { BrowserSession, BrowserConnection } from "../browser/types";
import { ResourceNotFoundError } from "../resource/types";

function makeSession(id: string): BrowserSession {
  return {
    id,
    getConnection: async (): Promise<BrowserConnection> => ({
      url: `wss://example/${id}`,
      headers: { authorization: "sig" },
    }),
    destroy: async () => {},
  };
}

function makeContext(overrides?: Partial<RouterContext>): RouterContext {
  return {
    threadId: "thread-1",
    toolCallId: "tc-1",
    toolName: "BrowserNavigate",
    ...overrides,
  };
}

describe("withBrowser", () => {
  it("resolves the session and forwards it to the inner handler", async () => {
    const session = makeSession("br-1");
    const manager = { getBrowserSession: async () => session };

    const handler = withBrowser<
      { ok: boolean },
      { url: string }
    >(manager, async (_args, ctx) => {
      const conn = await ctx.browserSession.getConnection();
      return {
        toolResponse: "navigated",
        data: { url: conn.url },
      } satisfies ToolHandlerResponse<{ url: string }, string>;
    });

    const result = await handler(
      { ok: true },
      makeContext({ browserSessionId: "br-1" })
    );

    expect(result.data).toEqual({ url: "wss://example/br-1" });
    expect(result.toolResponse).toBe("navigated");
  });

  it("short-circuits with an error when no browserSessionId is present", async () => {
    let called = false;
    const manager = {
      getBrowserSession: async () => {
        called = true;
        return makeSession("br-1");
      },
    };

    const handler = withBrowser(manager, async () => ({
      toolResponse: "ok",
      data: null,
    }));

    const result = await handler({}, makeContext());

    expect(called).toBe(false);
    expect(result.data).toBeNull();
    expect(String(result.toolResponse)).toContain("No browser session");
  });

  it("propagates ResourceNotFoundError by default", async () => {
    const manager = {
      getBrowserSession: async (): Promise<BrowserSession> => {
        throw new ResourceNotFoundError("br-gone");
      },
    };

    const handler = withBrowser(manager, async () => ({
      toolResponse: "ok",
      data: null,
    }));

    await expect(
      handler({}, makeContext({ browserSessionId: "br-gone" }))
    ).rejects.toThrow(ResourceNotFoundError);
  });

  it("translates ResourceNotFoundError into a tool response when enabled", async () => {
    const manager = {
      getBrowserSession: async (): Promise<BrowserSession> => {
        throw new ResourceNotFoundError("br-gone");
      },
    };

    const handler = withBrowser(
      manager,
      async () => ({ toolResponse: "ok", data: null }),
      { translateSessionNotFound: true }
    );

    const result = await handler(
      {},
      makeContext({ browserSessionId: "br-gone" })
    );

    expect(result.data).toBeNull();
    expect(String(result.toolResponse)).toContain("no longer available");
  });
});
