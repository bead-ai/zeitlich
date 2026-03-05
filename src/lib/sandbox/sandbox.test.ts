import { describe, expect, it, beforeEach } from "vitest";
import { SandboxManager } from "./manager";
import { InMemorySandboxProvider } from "../../adapters/sandbox/inmemory/index";
import { SandboxNotFoundError } from "./types";

describe("SandboxManager", () => {
  let manager: SandboxManager;

  beforeEach(() => {
    manager = new SandboxManager(new InMemorySandboxProvider());
  });

  it("creates a sandbox and returns an id", async () => {
    const id = await manager.create();
    expect(id).toBeTruthy();
    expect(manager.has(id)).toBe(true);
  });

  it("creates a sandbox with a custom id", async () => {
    const id = await manager.create({ id: "my-sandbox" });
    expect(id).toBe("my-sandbox");
  });

  it("gets an existing sandbox", async () => {
    const id = await manager.create();
    const sandbox = manager.getSandbox(id);
    expect(sandbox.id).toBe(id);
  });

  it("throws SandboxNotFoundError for unknown id", () => {
    expect(() => manager.getSandbox("nonexistent")).toThrow(
      SandboxNotFoundError,
    );
  });

  it("destroys a sandbox", async () => {
    const id = await manager.create();
    expect(manager.has(id)).toBe(true);
    await manager.destroy(id);
    expect(manager.has(id)).toBe(false);
  });

  it("destroy is idempotent for unknown ids", async () => {
    await expect(manager.destroy("nonexistent")).resolves.not.toThrow();
  });

  it("snapshots and restores a sandbox", async () => {
    const id = await manager.create({
      initialFiles: { "/data.txt": "hello" },
    });
    const sandbox = manager.getSandbox(id);
    await sandbox.fs.writeFile("/extra.txt", "world");

    const snapshot = await manager.snapshot(id);
    expect(snapshot.sandboxId).toBe(id);
    expect(snapshot.providerId).toBe("inmemory");

    await manager.destroy(id);
    expect(manager.has(id)).toBe(false);

    const restoredId = await manager.restore(snapshot);
    expect(restoredId).toBe(id);
    const restored = manager.getSandbox(restoredId);
    const content = await restored.fs.readFile("/data.txt");
    expect(content).toBe("hello");
    const extra = await restored.fs.readFile("/extra.txt");
    expect(extra).toBe("world");
  });

  it("createActivities returns SandboxOps-shaped object", async () => {
    const activities = manager.createActivities();
    expect(activities.createSandbox).toBeTypeOf("function");
    expect(activities.destroySandbox).toBeTypeOf("function");
    expect(activities.snapshotSandbox).toBeTypeOf("function");

    const { sandboxId } = await activities.createSandbox();
    expect(manager.has(sandboxId)).toBe(true);

    await activities.destroySandbox(sandboxId);
    expect(manager.has(sandboxId)).toBe(false);
  });
});

describe("InMemorySandboxProvider", () => {
  let manager: SandboxManager;

  beforeEach(() => {
    manager = new SandboxManager(new InMemorySandboxProvider());
  });

  it("creates sandbox with initial files", async () => {
    const id = await manager.create({
      initialFiles: {
        "/src/index.ts": 'console.log("hello");',
        "/README.md": "# Hello",
      },
    });
    const sandbox = manager.getSandbox(id);
    const content = await sandbox.fs.readFile("/src/index.ts");
    expect(content).toBe('console.log("hello");');
  });

  it("supports filesystem operations", async () => {
    const id = await manager.create();
    const { fs } = manager.getSandbox(id);

    await fs.writeFile("/test.txt", "hello");
    expect(await fs.exists("/test.txt")).toBe(true);
    expect(await fs.readFile("/test.txt")).toBe("hello");

    await fs.appendFile("/test.txt", " world");
    expect(await fs.readFile("/test.txt")).toBe("hello world");

    await fs.mkdir("/mydir", { recursive: true });
    expect(await fs.exists("/mydir")).toBe(true);

    const stat = await fs.stat("/test.txt");
    expect(stat.isFile).toBe(true);
    expect(stat.isDirectory).toBe(false);
  });

  it("supports shell execution", async () => {
    const id = await manager.create({
      initialFiles: { "/data.txt": "hello world" },
    });
    const sandbox = manager.getSandbox(id);

    const result = await sandbox.exec("cat /data.txt");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello world");
  });

  it("reports correct capabilities", async () => {
    const id = await manager.create();
    const sandbox = manager.getSandbox(id);
    expect(sandbox.capabilities).toEqual({
      filesystem: true,
      execution: true,
      persistence: true,
    });
  });

  it("readdirWithFileTypes works", async () => {
    const id = await manager.create({
      initialFiles: {
        "/dir/a.txt": "a",
        "/dir/b.txt": "b",
      },
    });
    const { fs } = manager.getSandbox(id);
    const entries = await fs.readdirWithFileTypes("/dir");
    expect(entries.length).toBe(2);
    expect(entries.every((e) => e.isFile)).toBe(true);
  });
});
