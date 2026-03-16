import { describe, it, expect, vi, beforeEach } from "vitest";
import { DaytonaSandboxProvider } from "./index";
import type { SandboxSnapshot } from "../../../lib/sandbox/types";

// ---------------------------------------------------------------------------
// Minimal SDK mocks
// ---------------------------------------------------------------------------

const mockProcess = {
  executeCommand: vi.fn().mockResolvedValue({ exitCode: 0, result: "" }),
};

const mockSrcSandboxFs = {
  downloadFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
};

const mockTempSandboxFs = {
  uploadFile: vi.fn().mockResolvedValue(undefined),
};

const mockTempSandboxProcess = {
  executeCommand: vi.fn().mockResolvedValue({ exitCode: 0, result: "" }),
};

const mockVolume = { id: "vol-1", name: "snapshot-sb-1-123" };
const mockRestoredSandbox = { id: "sb-restored", process: mockProcess, fs: mockSrcSandboxFs };

const mockClient = {
  get: vi.fn(),
  create: vi.fn(),
  delete: vi.fn().mockResolvedValue(undefined),
  volume: {
    create: vi.fn().mockResolvedValue(mockVolume),
    get: vi.fn().mockResolvedValue(mockVolume),
    delete: vi.fn().mockResolvedValue(undefined),
  },
};

vi.mock("@daytonaio/sdk", () => ({
  Daytona: vi.fn().mockImplementation(function () { return mockClient; }),
}));

// ---------------------------------------------------------------------------

function makeSnapshot(overrides?: Partial<SandboxSnapshot>): SandboxSnapshot {
  return {
    sandboxId: "sb-1",
    providerId: "daytona",
    data: { volumeId: "vol-1", volumeName: "snapshot-sb-1-123", workspaceBase: "/home/daytona" },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("DaytonaSandboxProvider.snapshot()", () => {
  let provider: DaytonaSandboxProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new DaytonaSandboxProvider();

    const srcSandbox = {
      id: "sb-1",
      process: mockProcess,
      fs: mockSrcSandboxFs,
    };
    const tempSandbox = {
      id: "sb-temp",
      process: mockTempSandboxProcess,
      fs: mockTempSandboxFs,
    };

    // First get() call returns src sandbox; create() for temp sandbox
    mockClient.get.mockResolvedValue(srcSandbox);
    mockClient.create.mockResolvedValue(tempSandbox);
  });

  it("returns a snapshot with correct shape", async () => {
    const snapshot = await provider.snapshot("sb-1");

    expect(snapshot.sandboxId).toBe("sb-1");
    expect(snapshot.providerId).toBe("daytona");
    expect(snapshot.createdAt).toBeTruthy();
    expect(snapshot.data).toMatchObject({
      volumeId: mockVolume.id,
      volumeName: mockVolume.name,
      workspaceBase: "/home/daytona",
    });
  });

  it("tars the workspace and extracts it into the volume sandbox", async () => {
    await provider.snapshot("sb-1");

    expect(mockProcess.executeCommand).toHaveBeenCalledWith(
      expect.stringContaining("tar czf /tmp/snapshot.tar.gz")
    );
    expect(mockTempSandboxProcess.executeCommand).toHaveBeenCalledWith(
      expect.stringContaining("tar xzf /tmp/snapshot.tar.gz")
    );
  });

  it("deletes the temp sandbox even if extraction fails", async () => {
    mockTempSandboxProcess.executeCommand.mockRejectedValueOnce(new Error("disk full"));

    await expect(provider.snapshot("sb-1")).rejects.toThrow("disk full");

    expect(mockClient.delete).toHaveBeenCalled();
  });

  it("deletes the volume if the overall snapshot fails", async () => {
    mockClient.get.mockRejectedValueOnce(new Error("sandbox not found"));

    await expect(provider.snapshot("sb-1")).rejects.toThrow("sandbox not found");

    expect(mockClient.volume.delete).toHaveBeenCalledWith(mockVolume);
  });

  it("uses default workspaceBase when sandbox id is not in the internal map", async () => {
    const snapshot = await provider.snapshot("unknown-sb");

    expect(snapshot.data).toMatchObject({ workspaceBase: "/home/daytona" });
  });

  it("uses custom workspaceBase when set at create time", async () => {
    const customBase = "/workspace";
    const sdkSandbox = { id: "sb-custom", process: mockProcess, fs: mockSrcSandboxFs };
    const tempSandbox = { id: "sb-temp", process: mockTempSandboxProcess, fs: mockTempSandboxFs };

    mockClient.create
      .mockResolvedValueOnce(sdkSandbox)   // provider.create()
      .mockResolvedValueOnce(tempSandbox); // temp sandbox inside snapshot()
    mockClient.get.mockResolvedValue(sdkSandbox);

    await provider.create({ workspaceBase: customBase });
    const snapshot = await provider.snapshot("sb-custom");

    expect(snapshot.data).toMatchObject({ workspaceBase: customBase });
  });
});

describe("DaytonaSandboxProvider.restore()", () => {
  let provider: DaytonaSandboxProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new DaytonaSandboxProvider();
    mockClient.create.mockResolvedValue(mockRestoredSandbox);
    mockClient.volume.get.mockResolvedValue(mockVolume);
  });

  it("returns a sandbox with the snapshot's sandboxId as its id", async () => {
    const snapshot = makeSnapshot();
    const sandbox = await provider.restore(snapshot);

    expect(sandbox).not.toBeNull();
    expect(sandbox?.id).toBe(mockRestoredSandbox.id);
  });

  it("creates the new sandbox with the volume mounted", async () => {
    const snapshot = makeSnapshot();
    await provider.restore(snapshot);

    expect(mockClient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        volumes: expect.arrayContaining([
          expect.objectContaining({ volumeId: "vol-1" }),
        ]),
      })
    );
  });

  it("deletes the volume after restore to free resources", async () => {
    const snapshot = makeSnapshot();
    await provider.restore(snapshot);

    expect(mockClient.volume.delete).toHaveBeenCalledWith(mockVolume);
  });

  it("returns null when the volume no longer exists", async () => {
    mockClient.volume.get.mockRejectedValueOnce(new Error("not found"));

    const snapshot = makeSnapshot();
    const result = await provider.restore(snapshot);

    expect(result).toBeNull();
    expect(mockClient.create).not.toHaveBeenCalled();
  });

  it("uses the workspaceBase from the snapshot data", async () => {
    const snapshot = makeSnapshot({
      data: { volumeId: "vol-1", volumeName: "snap", workspaceBase: "/custom" },
    });
    await provider.restore(snapshot);

    expect(mockClient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        volumes: expect.arrayContaining([
          expect.objectContaining({ mountPath: "/custom" }),
        ]),
      })
    );
  });
});
