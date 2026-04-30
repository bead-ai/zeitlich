import { describe, it, expect, vi } from "vitest";
import type { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import { BedrockRuntimeSandboxProvider } from "./index";

/**
 * Unit tests for the bedrock-runtime adapter that don't need a live AWS
 * runtime. Live behaviour is covered separately in
 * `./test/integration.test.ts`.
 */

function makeProvider(): BedrockRuntimeSandboxProvider {
  return new BedrockRuntimeSandboxProvider({
    agentRuntimeArn: "arn:aws:bedrock-agentcore:us-west-2:000000000000:runtime/test-fake",
    clientConfig: { region: "us-west-2" },
  });
}

/** Pull the (private) SDK client off the provider for stubbing. */
function stubClient(provider: BedrockRuntimeSandboxProvider): BedrockAgentCoreClient {
  return (provider as unknown as { client: BedrockAgentCoreClient }).client;
}

describe("BedrockRuntimeSandboxProvider.pause()", () => {
  it("returns successfully when StopRuntimeSession reports the session is already gone", async () => {
    const provider = makeProvider();
    const client = stubClient(provider);

    // AWS SDK surfaces a "session already stopped/expired" race as
    // ResourceNotFoundException. Temporal-style activity retries hit
    // this when the first attempt's StopRuntimeSession succeeded but
    // the response was lost in transit; pause() must treat it as a
    // successful idempotent no-op.
    const notFound = new Error(
      "Session zeitlich-abc123 not found or has been terminated"
    );
    notFound.name = "ResourceNotFoundException";

    vi.spyOn(client, "send").mockRejectedValueOnce(notFound as never);

    await expect(
      provider.pause("zeitlich-abc123")
    ).resolves.toBeUndefined();
  });

  it("rethrows non-NotFound errors so real failures are not silently swallowed", async () => {
    const provider = makeProvider();
    const client = stubClient(provider);

    const accessDenied = new Error(
      "User: arn:aws:sts::... is not authorized to perform: bedrock-agentcore:StopRuntimeSession"
    );
    accessDenied.name = "AccessDeniedException";

    vi.spyOn(client, "send").mockRejectedValueOnce(accessDenied as never);

    await expect(provider.pause("zeitlich-abc123")).rejects.toThrow(
      /not authorized/
    );
  });

  it("returns successfully when StopRuntimeSession resolves normally", async () => {
    const provider = makeProvider();
    const client = stubClient(provider);

    vi.spyOn(client, "send").mockResolvedValueOnce({
      runtimeSessionId: "zeitlich-abc123",
      statusCode: 200,
    } as never);

    await expect(
      provider.pause("zeitlich-abc123")
    ).resolves.toBeUndefined();
  });
});
