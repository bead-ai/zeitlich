import { describe, expect, it, beforeEach } from "vitest";
import { createBashHandler } from "./handler";
import { SandboxManager } from "../../lib/sandbox/manager";
import { InMemorySandboxProvider } from "../../adapters/sandbox/inmemory/index";
import type { RouterContext } from "../../lib/tool-router/types";

describe("bash handler with sandbox", () => {
  let manager: SandboxManager;
  let sandboxId: string;

  beforeEach(async () => {
    manager = new SandboxManager(new InMemorySandboxProvider());
    sandboxId = await manager.create({
      initialFiles: { "/home/user/hello.txt": "world" },
    });
  });

  const ctx = (id: string): RouterContext => ({
    sandboxId: id,
    threadId: "test-thread",
    toolCallId: "test-call",
    toolName: "Bash",
  });

  it("executes echo and captures stdout", async () => {
    const handler = createBashHandler(manager.getSandbox.bind(manager));
    const { data } = await handler(
      { command: "echo 'hello world'" },
      ctx(sandboxId)
    );
    expect(data).not.toBeNull();
    expect(data?.stdout.trim()).toBe("hello world");
    expect(data?.exitCode).toBe(0);
  });

  it("returns exit code 0 for successful commands", async () => {
    const handler = createBashHandler(manager.getSandbox.bind(manager));
    const { data } = await handler({ command: "true" }, ctx(sandboxId));
    expect(data?.exitCode).toBe(0);
  });

  it("returns non-zero exit code for failed commands", async () => {
    const handler = createBashHandler(manager.getSandbox.bind(manager));
    const { data } = await handler({ command: "false" }, ctx(sandboxId));
    expect(data?.exitCode).toBe(1);
  });

  it("captures stderr output", async () => {
    const handler = createBashHandler(manager.getSandbox.bind(manager));
    const { data } = await handler(
      { command: "echo 'error message' >&2" },
      ctx(sandboxId)
    );
    expect(data?.stderr.trim()).toBe("error message");
    expect(data?.stdout.trim()).toBe("");
  });

  it("supports piping between commands", async () => {
    const handler = createBashHandler(manager.getSandbox.bind(manager));
    const { data } = await handler(
      { command: "echo 'hello world' | tr 'a-z' 'A-Z'" },
      ctx(sandboxId)
    );
    expect(data?.stdout.trim()).toBe("HELLO WORLD");
  });

  it("supports command chaining with &&", async () => {
    const handler = createBashHandler(manager.getSandbox.bind(manager));
    const { data } = await handler(
      { command: "echo 'first' && echo 'second'" },
      ctx(sandboxId)
    );
    expect(data?.stdout).toContain("first");
    expect(data?.stdout).toContain("second");
  });

  it("returns toolResponse string with formatted output", async () => {
    const handler = createBashHandler(manager.getSandbox.bind(manager));
    const { toolResponse } = await handler(
      { command: "echo 'test'" },
      ctx(sandboxId)
    );
    expect(toolResponse).toContain("Exit code: 0");
    expect(toolResponse).toContain("stdout:");
    expect(toolResponse).toContain("test");
  });

  it("returns error when no sandboxId in context", async () => {
    const handler = createBashHandler(manager.getSandbox.bind(manager));
    const { toolResponse, data } = await handler({ command: "echo hi" }, {
      threadId: "test-thread",
      toolCallId: "test-call",
      toolName: "Bash",
    });
    expect(toolResponse).toContain("No sandbox configured");
    expect(data).toBeNull();
  });

  it("can read files from the sandbox filesystem", async () => {
    const handler = createBashHandler(manager.getSandbox.bind(manager));
    const { data } = await handler(
      { command: "cat /home/user/hello.txt" },
      ctx(sandboxId)
    );
    expect(data?.stdout).toBe("world");
  });
});
