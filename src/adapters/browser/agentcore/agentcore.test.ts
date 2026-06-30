import { describe, expect, it, vi, beforeEach } from "vitest";
import { AgentCoreBrowserProvider } from "./index";
import { ResourceNotFoundError } from "../../../lib/resource/types";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("@aws-sdk/client-bedrock-agentcore", () => {
  class StartBrowserSessionCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class GetBrowserSessionCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class StopBrowserSessionCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class ResourceNotFoundException extends Error {}
  class BedrockAgentCoreClient {
    config = {
      credentials: async () => ({
        accessKeyId: "AK",
        secretAccessKey: "SK",
      }),
    };
    send = sendMock;
  }
  return {
    BedrockAgentCoreClient,
    StartBrowserSessionCommand,
    GetBrowserSessionCommand,
    StopBrowserSessionCommand,
    ResourceNotFoundException,
  };
});

vi.mock("@aws-sdk/signature-v4", () => ({
  SignatureV4: class {
    async sign(req: { headers: Record<string, string> }) {
      return {
        ...req,
        headers: {
          ...req.headers,
          authorization: "AWS4-HMAC-SHA256 Credential=AK/...",
          "x-amz-date": "20260101T000000Z",
        },
      };
    }
  },
}));

vi.mock("@aws-crypto/sha256-js", () => ({
  Sha256: class {
    update(): void {}
    digest(): Uint8Array {
      return new Uint8Array();
    }
  },
}));

import {
  ResourceNotFoundException,
  StartBrowserSessionCommand,
  StopBrowserSessionCommand,
} from "@aws-sdk/client-bedrock-agentcore";

/** Construct the mocked `ResourceNotFoundException` (its mock ctor takes a string). */
function notFound(message: string): Error {
  const Ctor = ResourceNotFoundException as unknown as new (m: string) => Error;
  return new Ctor(message);
}

describe("AgentCoreBrowserProvider", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it("starts a session with the default browser identifier", async () => {
    sendMock.mockResolvedValueOnce({
      sessionId: "sess-1",
      browserIdentifier: "aws.browser.v1",
      createdAt: new Date(),
    });

    const provider = new AgentCoreBrowserProvider({
      region: "us-west-2",
      sessionTimeoutSeconds: 600,
    });
    const { session } = await provider.create({ name: "my-session" });

    expect(session.id).toBe("sess-1");
    const [cmd] = sendMock.mock.calls[0] as [StartBrowserSessionCommand];
    expect(cmd).toBeInstanceOf(StartBrowserSessionCommand);
    expect(cmd.input).toMatchObject({
      browserIdentifier: "aws.browser.v1",
      name: "my-session",
      sessionTimeoutSeconds: 600,
    });
  });

  it("throws if StartBrowserSession returns no sessionId", async () => {
    sendMock.mockResolvedValueOnce({});
    const provider = new AgentCoreBrowserProvider({ region: "us-west-2" });
    await expect(provider.create()).rejects.toThrow(/no sessionId/);
  });

  it("produces a SigV4-signed CDP connection", async () => {
    sendMock.mockResolvedValueOnce({ sessionId: "sess-2" });
    const provider = new AgentCoreBrowserProvider({ region: "us-west-2" });
    const { session } = await provider.create();

    const conn = await session.getConnection();
    expect(conn.url).toBe(
      "wss://bedrock-agentcore.us-west-2.amazonaws.com/browser-streams/aws.browser.v1/sessions/sess-2/automation"
    );
    expect(conn.headers.authorization).toContain("AWS4-HMAC-SHA256");
  });

  it("maps ResourceNotFoundException to ResourceNotFoundError on get()", async () => {
    sendMock.mockRejectedValueOnce(notFound("gone"));
    const provider = new AgentCoreBrowserProvider({ region: "us-west-2" });
    await expect(provider.get("missing")).rejects.toThrow(
      ResourceNotFoundError
    );
  });

  it("stops the session on destroy and is idempotent when already gone", async () => {
    const provider = new AgentCoreBrowserProvider({ region: "us-west-2" });

    sendMock.mockResolvedValueOnce(undefined);
    await provider.destroy("sess-3");
    const [cmd] = sendMock.mock.calls[0] as [StopBrowserSessionCommand];
    expect(cmd).toBeInstanceOf(StopBrowserSessionCommand);
    expect(cmd.input).toMatchObject({ sessionId: "sess-3" });

    sendMock.mockRejectedValueOnce(notFound("gone"));
    await expect(provider.destroy("sess-3")).resolves.toBeUndefined();
  });
});
