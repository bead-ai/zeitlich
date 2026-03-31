import { describe, expect, it, beforeEach } from "vitest";
import { SandboxManager } from "./manager";
import { InMemorySandboxProvider } from "../../adapters/sandbox/inmemory/index";
import {
  SandboxNotFoundError,
  type Sandbox,
  type SandboxCreateOptions,
} from "./types";

async function mustCreate<T extends SandboxCreateOptions, TId extends string>(
  mgr: SandboxManager<T, Sandbox, TId>,
  options?: T
): Promise<{ sandboxId: string }> {
  const result = await mgr.create(options);
  expect(result).not.toBeNull();
  return result as NonNullable<typeof result>;
}

describe("SandboxManager", () => {
  let manager: SandboxManager<SandboxCreateOptions, Sandbox, "inMemory">;

  beforeEach(() => {
    manager = new SandboxManager(new InMemorySandboxProvider());
  });

  it("creates a sandbox and returns an id", async () => {
    const { sandboxId } = await mustCreate(manager);
    expect(sandboxId).toBeTruthy();
    const sandbox = await manager.getSandbox(sandboxId);
    expect(sandbox.id).toBe(sandboxId);
  });

  it("creates a sandbox with a custom id", async () => {
    const { sandboxId } = await mustCreate(manager, { id: "my-sandbox" });
    expect(sandboxId).toBe("my-sandbox");
  });

  it("gets an existing sandbox", async () => {
    const { sandboxId } = await mustCreate(manager);
    const sandbox = await manager.getSandbox(sandboxId);
    expect(sandbox.id).toBe(sandboxId);
  });

  it("throws SandboxNotFoundError for unknown id", async () => {
    await expect(manager.getSandbox("nonexistent")).rejects.toThrow(
      SandboxNotFoundError
    );
  });

  it("destroys a sandbox", async () => {
    const { sandboxId } = await mustCreate(manager);
    await manager.getSandbox(sandboxId);
    await manager.destroy(sandboxId);
    await expect(manager.getSandbox(sandboxId)).rejects.toThrow(
      SandboxNotFoundError
    );
  });

  it("destroy is idempotent for unknown ids", async () => {
    await expect(manager.destroy("nonexistent")).resolves.not.toThrow();
  });

  it("snapshots and restores a sandbox", async () => {
    const { sandboxId } = await mustCreate(manager, {
      initialFiles: { "/data.txt": "hello" },
    });
    const sandbox = await manager.getSandbox(sandboxId);
    await sandbox.fs.writeFile("/extra.txt", "world");

    const snapshot = await manager.snapshot(sandboxId);
    expect(snapshot.sandboxId).toBe(sandboxId);
    expect(snapshot.providerId).toBe("inMemory");

    await manager.destroy(sandboxId);
    await expect(manager.getSandbox(sandboxId)).rejects.toThrow(
      SandboxNotFoundError
    );

    const restoredId = await manager.restore(snapshot);
    expect(restoredId).toBe(sandboxId);
    const restored = await manager.getSandbox(restoredId);
    const content = await restored.fs.readFile("/data.txt");
    expect(content).toBe("hello");
    const extra = await restored.fs.readFile("/extra.txt");
    expect(extra).toBe("world");
  });

  it("onPreCreate hook merges modifiedOptions into create options", async () => {
    const mgr = new SandboxManager(new InMemorySandboxProvider(), {
      hooks: {
        onPreCreate: async (_options, ctx) => {
          const { paths } = ctx as { paths: string[] };
          const files: Record<string, string> = {};
          for (const p of paths) files[p] = `content of ${p}`;
          return {
            modifiedOptions: { initialFiles: files, env: { RESOLVED: "true" } },
          };
        },
      },
    });

    const result = await mgr.create(
      { initialFiles: { "/extra.txt": "extra" } },
      { paths: ["/a.txt", "/b.txt"] }
    );
    expect(result).not.toBeNull();
    const { sandboxId } = result as NonNullable<typeof result>;

    const sandbox = await mgr.getSandbox(sandboxId);
    expect(await sandbox.fs.readFile("/a.txt")).toBe("content of /a.txt");
    expect(await sandbox.fs.readFile("/b.txt")).toBe("content of /b.txt");
    expect(await sandbox.fs.readFile("/extra.txt")).toBe("extra");
  });

  it("ctx is not forwarded to provider when no hooks registered", async () => {
    const result = await manager.create(
      { initialFiles: { "/test.txt": "ok" } },
      { foo: "bar" }
    );
    expect(result).not.toBeNull();
    const { sandboxId } = result as NonNullable<typeof result>;
    const sandbox = await manager.getSandbox(sandboxId);
    expect(await sandbox.fs.readFile("/test.txt")).toBe("ok");
  });

  it("onPreCreate hook can skip sandbox creation", async () => {
    const mgr = new SandboxManager(new InMemorySandboxProvider(), {
      hooks: {
        onPreCreate: async () => ({ skip: true }),
      },
    });

    const result = await mgr.create(undefined, { skip: true });
    expect(result).toBeNull();
  });

  it("original options take precedence over hook modifiedOptions", async () => {
    const mgr = new SandboxManager(new InMemorySandboxProvider(), {
      hooks: {
        onPreCreate: async () => ({
          modifiedOptions: {
            initialFiles: { "/file.txt": "from-hook" },
            env: { KEY: "hook" },
          },
        }),
      },
    });

    const result = await mgr.create(
      { initialFiles: { "/file.txt": "explicit" } },
      {}
    );
    expect(result).not.toBeNull();
    const { sandboxId } = result as NonNullable<typeof result>;

    const sandbox = await mgr.getSandbox(sandboxId);
    expect(await sandbox.fs.readFile("/file.txt")).toBe("explicit");
  });

  it("onPostCreate hook receives sandboxId", async () => {
    let capturedId: string | undefined;
    const mgr = new SandboxManager(new InMemorySandboxProvider(), {
      hooks: {
        onPostCreate: async (sandboxId) => {
          capturedId = sandboxId;
        },
      },
    });

    const { sandboxId } = await mustCreate(mgr);
    expect(capturedId).toBe(sandboxId);
  });

  it("onPostCreate hook does not run when creation is skipped", async () => {
    let postCalled = false;
    const mgr = new SandboxManager(new InMemorySandboxProvider(), {
      hooks: {
        onPreCreate: async () => ({ skip: true }),
        onPostCreate: async () => {
          postCalled = true;
        },
      },
    });

    await mgr.create();
    expect(postCalled).toBe(false);
  });

  it("createActivities returns prefixed SandboxOps-shaped object", async () => {
    // provider.id is "inMemory", scope is "Test" → prefix "inMemoryTest"
    const activities = manager.createActivities("Test");
    expect(activities.inMemoryTestCreateSandbox).toBeTypeOf("function");
    expect(activities.inMemoryTestDestroySandbox).toBeTypeOf("function");
    expect(activities.inMemoryTestSnapshotSandbox).toBeTypeOf("function");

    const result = await activities.inMemoryTestCreateSandbox();
    expect(result).not.toBeNull();
    const { sandboxId } = result as NonNullable<typeof result>;
    await expect(manager.getSandbox(sandboxId)).resolves.toBeTruthy();

    await activities.inMemoryTestDestroySandbox(sandboxId);
    await expect(manager.getSandbox(sandboxId)).rejects.toThrow(
      SandboxNotFoundError
    );
  });
});

describe("InMemorySandboxProvider", () => {
  let manager: SandboxManager<SandboxCreateOptions, Sandbox, "inMemory">;

  beforeEach(() => {
    manager = new SandboxManager(new InMemorySandboxProvider());
  });

  it("creates sandbox with initial files", async () => {
    const { sandboxId } = await mustCreate(manager, {
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
    const { sandboxId } = await mustCreate(manager);
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
    const { sandboxId } = await mustCreate(manager, {
      initialFiles: { "/data.txt": "hello world" },
    });
    const sandbox = await manager.getSandbox(sandboxId);

    const result = await sandbox.exec("cat /data.txt");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello world");
  });

  it("reports correct capabilities", async () => {
    const { sandboxId } = await mustCreate(manager);
    const sandbox = await manager.getSandbox(sandboxId);
    expect(sandbox.capabilities).toEqual({
      filesystem: true,
      execution: true,
      persistence: true,
    });
  });

  it("readdirWithFileTypes works", async () => {
    const { sandboxId } = await mustCreate(manager, {
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
