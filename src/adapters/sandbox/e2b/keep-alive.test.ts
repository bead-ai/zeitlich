import { describe, expect, it, vi, beforeEach } from "vitest";
import { Sandbox as E2bSdkSandbox } from "@e2b/code-interpreter";
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
  return { Sandbox: FakeSdkSandbox };
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

  it("uses per-create keepAliveMs override over the provider default", async () => {
    const fakeCreated = makeFakeSdkSandbox("sbx-override");
    sdk.create.mockResolvedValue(fakeCreated);
    const fakeGet = makeFakeSdkSandbox("sbx-override");
    sdk.connect.mockResolvedValue(fakeGet);

    const provider = new E2bSandboxProvider({ keepAliveMs: 60_000 });
    await provider.create({ keepAliveMs: 5_000 });
    await provider.get("sbx-override");

    expect(sdk.connect).toHaveBeenCalledWith("sbx-override", {
      timeoutMs: 5_000,
    });
  });

  it("falls back to provider-level keepAliveMs for sandboxes without an override", async () => {
    const fakeGet = makeFakeSdkSandbox("sbx-default");
    sdk.connect.mockResolvedValue(fakeGet);

    const provider = new E2bSandboxProvider({ keepAliveMs: 60_000 });
    await provider.get("sbx-default");

    expect(sdk.connect).toHaveBeenCalledWith("sbx-default", {
      timeoutMs: 60_000,
    });
  });

  it("throws SandboxNotFoundError when connect rejects", async () => {
    sdk.connect.mockRejectedValue(new Error("boom"));

    const provider = new E2bSandboxProvider({ keepAliveMs: 60_000 });
    await expect(provider.get("missing")).rejects.toBeInstanceOf(
      SandboxNotFoundError
    );
  });

  it("honours per-call keepAliveMs passed to restore()", async () => {
    const fakeRestored = makeFakeSdkSandbox("sbx-restored");
    sdk.create.mockResolvedValue(fakeRestored);
    sdk.connect.mockResolvedValue(fakeRestored);

    const provider = new E2bSandboxProvider({ keepAliveMs: 60_000 });
    await provider.restore(
      {
        sandboxId: "ignored",
        providerId: "e2b",
        data: { snapshotId: "snap-1" },
        createdAt: new Date().toISOString(),
      },
      { keepAliveMs: 7_000 }
    );

    await provider.get("sbx-restored");
    expect(sdk.connect).toHaveBeenCalledWith("sbx-restored", {
      timeoutMs: 7_000,
    });
  });

  it("honours per-call keepAliveMs passed to fork()", async () => {
    sdk.createSnapshot.mockResolvedValue({ snapshotId: "snap-fork" });
    const fakeForked = makeFakeSdkSandbox("sbx-forked");
    sdk.create.mockResolvedValue(fakeForked);
    sdk.connect.mockResolvedValue(fakeForked);

    const provider = new E2bSandboxProvider({ keepAliveMs: 60_000 });
    await provider.fork("sbx-source", { keepAliveMs: 3_000 });

    await provider.get("sbx-forked");
    expect(sdk.connect).toHaveBeenCalledWith("sbx-forked", {
      timeoutMs: 3_000,
    });
  });

  it("clears per-sandbox keepAlive override on destroy", async () => {
    const fakeCreated = makeFakeSdkSandbox("sbx-destroy");
    sdk.create.mockResolvedValue(fakeCreated);
    const fakeConnected = makeFakeSdkSandbox("sbx-destroy");
    sdk.connect.mockResolvedValue(fakeConnected);

    const provider = new E2bSandboxProvider({ keepAliveMs: 60_000 });
    await provider.create({ keepAliveMs: 5_000 });
    await provider.destroy("sbx-destroy");

    sdk.connect.mockClear();
    sdk.connect.mockResolvedValue(fakeConnected);
    await provider.get("sbx-destroy");

    expect(sdk.connect).toHaveBeenCalledWith("sbx-destroy", {
      timeoutMs: 60_000,
    });
  });
});
