import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  Sandbox as E2bSdkSandbox,
  SandboxNotFoundError as E2bSandboxNotFoundError,
} from "@e2b/code-interpreter";
import { E2bSandboxProvider } from "./index";
import { SandboxNotFoundError } from "../../../lib/sandbox/types";

vi.mock("@e2b/code-interpreter", () => {
  class FakeSdkSandbox {
    static create = vi.fn();
    static connect = vi.fn();
    static createSnapshot = vi.fn();
    static deleteSnapshot = vi.fn();
    sandboxId: string;
    constructor(sandboxId: string) {
      this.sandboxId = sandboxId;
    }
    commands = { run: vi.fn() };
    files = {};
    async kill() {}
    async pause() {}
  }
  // Mirror the real SDK error class hierarchy: SandboxNotFoundError extends
  // (deprecated) NotFoundError extends SandboxError extends Error.
  class FakeSandboxError extends Error {}
  class FakeNotFoundError extends FakeSandboxError {}
  class FakeSandboxNotFoundError extends FakeNotFoundError {}
  return {
    Sandbox: FakeSdkSandbox,
    SandboxError: FakeSandboxError,
    NotFoundError: FakeNotFoundError,
    SandboxNotFoundError: FakeSandboxNotFoundError,
  };
});

const sdk = E2bSdkSandbox as unknown as {
  create: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  createSnapshot: ReturnType<typeof vi.fn>;
};

function makeFakeSdkSandbox(id = "sbx-1") {
  return {
    sandboxId: id,
    commands: { run: vi.fn() },
    files: {},
    kill: vi.fn(),
    pause: vi.fn(),
  };
}

describe("E2bSandboxProvider keep-alive", () => {
  beforeEach(() => {
    sdk.create.mockReset();
    sdk.connect.mockReset();
    sdk.createSnapshot.mockReset();
  });

  it("forwards timeoutMs to connect() when keepAliveMs is configured at the provider level", async () => {
    const fake = makeFakeSdkSandbox();
    sdk.connect.mockResolvedValue(fake);

    const provider = new E2bSandboxProvider({ keepAliveMs: 15 * 60 * 1000 });
    const sandbox = await provider.get("sbx-1");

    expect(sandbox.id).toBe("sbx-1");
    expect(sdk.connect).toHaveBeenCalledTimes(1);
    expect(sdk.connect).toHaveBeenCalledWith("sbx-1", {
      timeoutMs: 15 * 60 * 1000,
    });
  });

  it("omits timeoutMs from connect() when keepAliveMs is not configured", async () => {
    const fake = makeFakeSdkSandbox();
    sdk.connect.mockResolvedValue(fake);

    const provider = new E2bSandboxProvider();
    await provider.get("sbx-1");

    expect(sdk.connect).toHaveBeenCalledTimes(1);
    expect(sdk.connect).toHaveBeenCalledWith("sbx-1");
  });

  it("uses provider-level keepAliveMs for every sandbox managed by the provider", async () => {
    const fake = makeFakeSdkSandbox("sbx-default");
    sdk.connect.mockResolvedValue(fake);

    const provider = new E2bSandboxProvider({ keepAliveMs: 60_000 });
    await provider.get("sbx-default");

    expect(sdk.connect).toHaveBeenCalledWith("sbx-default", {
      timeoutMs: 60_000,
    });
  });

  it("translates the SDK's SandboxNotFoundError into our SandboxNotFoundError", async () => {
    sdk.connect.mockRejectedValue(
      new E2bSandboxNotFoundError("sandbox missing-sbx not found")
    );

    const provider = new E2bSandboxProvider({ keepAliveMs: 60_000 });
    await expect(provider.get("missing-sbx")).rejects.toBeInstanceOf(
      SandboxNotFoundError
    );
  });

  it("propagates non-not-found connect() errors unchanged (auth, network, 5xx)", async () => {
    const transient = new Error("ECONNRESET: socket hang up");
    sdk.connect.mockRejectedValue(transient);

    const provider = new E2bSandboxProvider({ keepAliveMs: 60_000 });
    await expect(provider.get("sbx-1")).rejects.toBe(transient);
  });
});
