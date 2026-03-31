import { describe, expect, it, beforeEach } from "vitest";
import { SandboxManager } from "./manager";
import { InMemorySandboxProvider } from "../../adapters/sandbox/inmemory/index";
import { SandboxNotFoundError, type Sandbox, type SandboxCreateOptions } from "./types";

describe("SandboxManager", () => {
  let manager: SandboxManager<SandboxCreateOptions, Sandbox, "inMemory">;

  beforeEach(() => {
    manager = new SandboxManager(new InMemorySandboxProvider());
  });

  it("creates a sandbox and returns an id", async () => {
    const { sandboxId } = await manager.create();
    expect(sandboxId).toBeTruthy();
    const sandbox = await manager.getSandbox(sandboxId);
    expect(sandbox.id).toBe(sandboxId);
  });

  it("creates a sandbox with a custom id", async () => {
    const { sandboxId } = await manager.create({ id: "my-sandbox" });
    expect(sandboxId).toBe("my-sandbox");
  });

  it("gets an existing sandbox", async () => {
    const { sandboxId } = await manager.create();
    const sandbox = await manager.getSandbox(sandboxId);
    expect(sandbox.id).toBe(sandboxId);
  });

  it("throws SandboxNotFoundError for unknown id", async () => {
    await expect(manager.getSandbox("nonexistent")).rejects.toThrow(
      SandboxNotFoundError,
    );
  });

  it("destroys a sandbox", async () => {
    const { sandboxId } = await manager.create();
    await manager.getSandbox(sandboxId);
    await manager.destroy(sandboxId);
    await expect(manager.getSandbox(sandboxId)).rejects.toThrow(SandboxNotFoundError);
  });

  it("destroy is idempotent for unknown ids", async () => {
    await expect(manager.destroy("nonexistent")).resolves.not.toThrow();
  });

  it("snapshots and restores a sandbox", async () => {
    const { sandboxId } = await manager.create({
      initialFiles: { "/data.txt": "hello" },
    });
    const sandbox = await manager.getSandbox(sandboxId);
    await sandbox.fs.writeFile("/extra.txt", "world");

    const snapshot = await manager.snapshot(sandboxId);
    expect(snapshot.sandboxId).toBe(sandboxId);
    expect(snapshot.providerId).toBe("inMemory");

    await manager.destroy(sandboxId);
    await expect(manager.getSandbox(sandboxId)).rejects.toThrow(SandboxNotFoundError);

    const restoredId = await manager.restore(snapshot);
    expect(restoredId).toBe(sandboxId);
    const restored = await manager.getSandbox(restoredId);
    const content = await restored.fs.readFile("/data.txt");
    expect(content).toBe("hello");
    const extra = await restored.fs.readFile("/extra.txt");
    expect(extra).toBe("world");
  });

  it("invokes resolver and merges options on create when resolverContext is present", async () => {
    const resolver = async (ctx: unknown) => {
      const { paths } = ctx as { paths: string[] };
      const files: Record<string, string> = {};
      for (const p of paths) files[p] = `content of ${p}`;
      return { initialFiles: files, env: { RESOLVED: "true" } };
    };
    const mgr = new SandboxManager(new InMemorySandboxProvider(), { resolver });

    const { sandboxId } = await mgr.create({
      resolverContext: { paths: ["/a.txt", "/b.txt"] },
      initialFiles: { "/extra.txt": "extra" },
    });

    const sandbox = await mgr.getSandbox(sandboxId);
    expect(await sandbox.fs.readFile("/a.txt")).toBe("content of /a.txt");
    expect(await sandbox.fs.readFile("/b.txt")).toBe("content of /b.txt");
    expect(await sandbox.fs.readFile("/extra.txt")).toBe("extra");
  });

  it("strips resolverContext before passing to provider when no resolver registered", async () => {
    const { sandboxId } = await manager.create({
      resolverContext: { foo: "bar" },
      initialFiles: { "/test.txt": "ok" },
    });
    const sandbox = await manager.getSandbox(sandboxId);
    expect(await sandbox.fs.readFile("/test.txt")).toBe("ok");
  });

  it("explicit options take precedence over resolved options", async () => {
    const resolver = async () => ({
      initialFiles: { "/file.txt": "from-resolver" },
      env: { KEY: "resolved" },
    });
    const mgr = new SandboxManager(new InMemorySandboxProvider(), { resolver });

    const { sandboxId } = await mgr.create({
      resolverContext: {},
      initialFiles: { "/file.txt": "explicit" },
    });

    const sandbox = await mgr.getSandbox(sandboxId);
    expect(await sandbox.fs.readFile("/file.txt")).toBe("explicit");
  });

  it("createActivities returns prefixed SandboxOps-shaped object", async () => {
    // provider.id is "inMemory", scope is "Test" → prefix "inMemoryTest"
    const activities = manager.createActivities("Test");
    expect(activities.inMemoryTestCreateSandbox).toBeTypeOf("function");
    expect(activities.inMemoryTestDestroySandbox).toBeTypeOf("function");
    expect(activities.inMemoryTestSnapshotSandbox).toBeTypeOf("function");

    const { sandboxId } = await activities.inMemoryTestCreateSandbox();
    await expect(manager.getSandbox(sandboxId)).resolves.toBeTruthy();

    await activities.inMemoryTestDestroySandbox(sandboxId);
    await expect(manager.getSandbox(sandboxId)).rejects.toThrow(
      SandboxNotFoundError,
    );
  });
});

describe("InMemorySandboxProvider", () => {
  let manager: SandboxManager<SandboxCreateOptions, Sandbox, "inMemory">;

  beforeEach(() => {
    manager = new SandboxManager(new InMemorySandboxProvider());
  });

  it("creates sandbox with initial files", async () => {
    const { sandboxId } = await manager.create({
      initialFiles: {
        "/src/index.ts": 'console.log("hello");',
        "/README.md": "# Hello",
      },
    });
    const sandbox = await manager.getSandbox(sandboxId);
    const content = await sandbox.fs.readFile("/src/index.ts");
    expect(content).toBe('console.log("hello");');
  });

  it("supports filesystem operations", async () => {
    const { sandboxId } = await manager.create();
    const { fs } = await manager.getSandbox(sandboxId);

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
    const { sandboxId } = await manager.create({
      initialFiles: { "/data.txt": "hello world" },
    });
    const sandbox = await manager.getSandbox(sandboxId);

    const result = await sandbox.exec("cat /data.txt");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello world");
  });

  it("reports correct capabilities", async () => {
    const { sandboxId } = await manager.create();
    const sandbox = await manager.getSandbox(sandboxId);
    expect(sandbox.capabilities).toEqual({
      filesystem: true,
      execution: true,
      persistence: true,
    });
  });

  it("readdirWithFileTypes works", async () => {
    const { sandboxId } = await manager.create({
      initialFiles: {
        "/dir/a.txt": "a",
        "/dir/b.txt": "b",
      },
    });
    const { fs } = await manager.getSandbox(sandboxId);
    const entries = await fs.readdirWithFileTypes("/dir");
    expect(entries.length).toBe(2);
    expect(entries.every((e) => e.isFile)).toBe(true);
  });
});
