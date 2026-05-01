import { describe, expect, it, vi } from "vitest";
import { withAutoAppend } from "./auto-append";
import { withSandbox } from "./with-sandbox";
import type { RouterContext, ToolHandlerResponse } from "./types";
import type { ToolResultConfig } from "../types";
import type { Sandbox } from "../sandbox/types";
import { SandboxNotFoundError } from "../sandbox/types";

// ---------------------------------------------------------------------------
// withAutoAppend
// ---------------------------------------------------------------------------

describe("withAutoAppend", () => {
  it("appends tool result via threadHandler and sets resultAppended", async () => {
    const appended: ToolResultConfig[] = [];
    const threadHandler = async (_id: string, config: ToolResultConfig) => {
      appended.push(config);
    };

    const innerHandler = async (
      args: { text: string },
      _ctx: RouterContext
    ): Promise<ToolHandlerResponse<{ echoed: string }>> => ({
      toolResponse: `Echo: ${args.text}`,
      data: { echoed: args.text },
    });

    const wrapped = withAutoAppend(threadHandler, innerHandler);

    const result = await wrapped(
      { text: "hello" },
      {
        threadId: "thread-1",
        toolCallId: "tc-1",
        toolName: "Echo",
      }
    );

    expect(result.resultAppended).toBe(true);
    expect(result.toolResponse).toBe("Response appended via withAutoAppend");
    expect(result.data).toEqual({ echoed: "hello" });

    expect(appended).toHaveLength(1);
    const firstAppended = appended.at(0);
    if (!firstAppended) throw new Error("expected appended item");
    expect(firstAppended.threadId).toBe("thread-1");
    expect(firstAppended.toolCallId).toBe("tc-1");
    expect(firstAppended.toolName).toBe("Echo");
    expect(firstAppended.content).toBe("Echo: hello");
  });

  it("preserves original data but replaces toolResponse", async () => {
    const threadHandler = async () => {};

    const innerHandler = async (): Promise<
      ToolHandlerResponse<{ large: string }>
    > => ({
      toolResponse: "A".repeat(10000),
      data: { large: "summary" },
    });

    const wrapped = withAutoAppend(threadHandler, innerHandler);

    const result = await wrapped(
      {},
      { threadId: "t", toolCallId: "tc", toolName: "BigTool" }
    );

    expect(result.toolResponse).toBe("Response appended via withAutoAppend");
    expect(result.data).toEqual({ large: "summary" });
    expect(result.resultAppended).toBe(true);
  });

  it("propagates handler errors without appending", async () => {
    const appendSpy = vi.fn();
    const threadHandler = appendSpy;

    const innerHandler = async (): Promise<ToolHandlerResponse<null>> => {
      throw new Error("handler failed");
    };

    const wrapped = withAutoAppend(threadHandler, innerHandler);

    await expect(
      wrapped({}, { threadId: "t", toolCallId: "tc", toolName: "Fail" })
    ).rejects.toThrow("handler failed");

    expect(appendSpy).not.toHaveBeenCalled();
  });

  it("uses correct context fields for thread handler config", async () => {
    let capturedConfig: ToolResultConfig | null = null;
    const threadHandler = async (_id: string, config: ToolResultConfig) => {
      capturedConfig = config;
    };

    const innerHandler = async (): Promise<ToolHandlerResponse<null>> => ({
      toolResponse: "result content",
      data: null,
    });

    const wrapped = withAutoAppend(threadHandler, innerHandler);

    await wrapped(
      {},
      {
        threadId: "my-thread",
        toolCallId: "my-tc",
        toolName: "MyTool",
        sandboxId: "sb-1",
      }
    );

    expect(capturedConfig).toEqual({
      threadId: "my-thread",
      toolCallId: "my-tc",
      toolName: "MyTool",
      content: "result content",
    });
  });

  it("forwards threadKey when present in context", async () => {
    let capturedConfig: ToolResultConfig | null = null;
    const threadHandler = async (_id: string, config: ToolResultConfig) => {
      capturedConfig = config;
    };

    const innerHandler = async (): Promise<ToolHandlerResponse<null>> => ({
      toolResponse: "content",
      data: null,
    });

    const wrapped = withAutoAppend(threadHandler, innerHandler);

    await wrapped(
      {},
      {
        threadId: "t-1",
        threadKey: "custom-key",
        toolCallId: "tc-1",
        toolName: "Tool",
      }
    );

    expect(capturedConfig).toEqual({
      threadId: "t-1",
      threadKey: "custom-key",
      toolCallId: "tc-1",
      toolName: "Tool",
      content: "content",
    });
  });

  it("omits threadKey from config when not in context", async () => {
    let capturedConfig: ToolResultConfig | null = null;
    const threadHandler = async (_id: string, config: ToolResultConfig) => {
      capturedConfig = config;
    };

    const innerHandler = async (): Promise<ToolHandlerResponse<null>> => ({
      toolResponse: "content",
      data: null,
    });

    const wrapped = withAutoAppend(threadHandler, innerHandler);

    await wrapped(
      {},
      { threadId: "t-1", toolCallId: "tc-1", toolName: "Tool" }
    );

    expect(capturedConfig).not.toBeNull();
    expect(capturedConfig).not.toHaveProperty("threadKey");
  });
});

// ---------------------------------------------------------------------------
// withSandbox
// ---------------------------------------------------------------------------

describe("withSandbox", () => {
  function createMockSandbox(): Sandbox {
    return {
      id: "mock-sandbox",
      capabilities: {
        filesystem: true,
        execution: true,
        persistence: false,
      },
      fs: {
        workspaceBase: "/",
        exists: async () => false,
        stat: async () => ({
          isFile: false,
          isDirectory: false,
          isSymbolicLink: false,
          size: 0,
          mtime: new Date(),
        }),
        readdir: async () => [],
        readdirWithFileTypes: async () => [],
        readFile: async () => "",
        readFileBuffer: async () => new Uint8Array(),
        writeFile: async () => {},
        appendFile: async () => {},
        mkdir: async () => {},
        rm: async () => {},
        cp: async () => {},
        mv: async () => {},
        readlink: async () => "",
        resolvePath: (base: string, path: string) => base + "/" + path,
      },
      exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      destroy: async () => {},
    };
  }

  it("resolves sandbox and passes it to handler", async () => {
    const mockSandbox = createMockSandbox();
    const manager = {
      getSandbox: async (id: string) => {
        expect(id).toBe("sb-42");
        return mockSandbox;
      },
    };

    let capturedSandbox: Sandbox | null = null;
    let capturedSandboxId: string | null = null;

    const handler = async (
      _args: { text: string },
      ctx: RouterContext & { sandbox: Sandbox; sandboxId: string }
    ): Promise<ToolHandlerResponse<null>> => {
      capturedSandbox = ctx.sandbox;
      capturedSandboxId = ctx.sandboxId;
      return { toolResponse: "ok", data: null };
    };

    const wrapped = withSandbox(manager, handler);

    const result = await wrapped(
      { text: "hello" },
      {
        threadId: "thread-1",
        toolCallId: "tc-1",
        toolName: "Test",
        sandboxId: "sb-42",
      }
    );

    expect(result.toolResponse).toBe("ok");
    expect(capturedSandbox).toBe(mockSandbox);
    expect(capturedSandboxId).toBe("sb-42");
  });

  it("returns error when no sandboxId is present", async () => {
    const manager = {
      getSandbox: vi.fn(),
    };

    const handler = async (): Promise<ToolHandlerResponse<string>> => ({
      toolResponse: "should not run",
      data: "nope",
    });

    const wrapped = withSandbox(manager, handler);

    const result = await wrapped(
      {},
      {
        threadId: "thread-1",
        toolCallId: "tc-1",
        toolName: "Bash",
      }
    );

    expect(result.toolResponse).toContain("No sandbox configured");
    expect(result.toolResponse).toContain("Bash");
    expect(result.data).toBeNull();
    expect(manager.getSandbox).not.toHaveBeenCalled();
  });

  it("returns error when sandboxId is undefined explicitly", async () => {
    const manager = {
      getSandbox: vi.fn(),
    };

    const handler = async (): Promise<ToolHandlerResponse<null>> => ({
      toolResponse: "nope",
      data: null,
    });

    const wrapped = withSandbox(manager, handler);

    const result = await wrapped(
      {},
      {
        threadId: "t",
        toolCallId: "tc",
        toolName: "Grep",
        sandboxId: undefined,
      }
    );

    expect(result.toolResponse).toContain("No sandbox configured");
    expect(result.data).toBeNull();
  });

  it("propagates getSandbox errors", async () => {
    const manager = {
      getSandbox: async () => {
        throw new Error("sandbox not found");
      },
    };

    const handler = async (): Promise<ToolHandlerResponse<null>> => ({
      toolResponse: "ok",
      data: null,
    });

    const wrapped = withSandbox(manager, handler);

    await expect(
      wrapped(
        {},
        {
          threadId: "t",
          toolCallId: "tc",
          toolName: "Test",
          sandboxId: "sb-missing",
        }
      )
    ).rejects.toThrow("sandbox not found");
  });

  it("propagates SandboxNotFoundError by default (no translate option)", async () => {
    const manager = {
      getSandbox: async (): Promise<Sandbox> => {
        throw new SandboxNotFoundError("sb-gone");
      },
    };

    const handler = async (): Promise<ToolHandlerResponse<null>> => ({
      toolResponse: "ok",
      data: null,
    });

    const wrapped = withSandbox(manager, handler);

    await expect(
      wrapped(
        {},
        {
          threadId: "t",
          toolCallId: "tc",
          toolName: "Bash",
          sandboxId: "sb-gone",
        }
      )
    ).rejects.toBeInstanceOf(SandboxNotFoundError);
  });

  it("translates SandboxNotFoundError into a structured response when opted in", async () => {
    const manager = {
      getSandbox: async (): Promise<Sandbox> => {
        throw new SandboxNotFoundError("sb-gone");
      },
    };

    const innerCalled = vi.fn();
    const handler = async (): Promise<ToolHandlerResponse<null>> => {
      innerCalled();
      return { toolResponse: "ok", data: null };
    };

    const wrapped = withSandbox(manager, handler, {
      translateSandboxNotFound: true,
    });

    const result = await wrapped(
      {},
      {
        threadId: "t",
        toolCallId: "tc",
        toolName: "Bash",
        sandboxId: "sb-gone",
      }
    );

    expect(result.toolResponse).toContain("Bash");
    expect(result.toolResponse).toContain("execution environment");
    expect(result.toolResponse).toContain("no longer available");
    expect(result.toolResponse).toContain("could not be completed");
    expect(result.toolResponse).not.toContain("session cannot continue");
    expect(result.data).toBeNull();
    expect(innerCalled).not.toHaveBeenCalled();
  });

  it("uses sandboxNotFoundToolResponse as the tool response when set", async () => {
    const manager = {
      getSandbox: async (): Promise<Sandbox> => {
        throw new SandboxNotFoundError("sb-gone");
      },
    };

    const handler = async (): Promise<ToolHandlerResponse<null>> => ({
      toolResponse: "ok",
      data: null,
    });

    const wrapped = withSandbox(manager, handler, {
      translateSandboxNotFound: true,
      sandboxNotFoundToolResponse:
        "El entorno de ejecución ya no está disponible. Reinicia el agente.",
    });

    const result = await wrapped(
      {},
      {
        threadId: "t",
        toolCallId: "tc",
        toolName: "Bash",
        sandboxId: "sb-gone",
      }
    );

    expect(result.toolResponse).toBe(
      "El entorno de ejecución ya no está disponible. Reinicia el agente."
    );
    expect(result.toolResponse).not.toContain("execution environment");
    expect(result.toolResponse).not.toContain("Bash");
    expect(result.data).toBeNull();
  });

  it("ignores sandboxNotFoundToolResponse when translateSandboxNotFound is not enabled", async () => {
    const manager = {
      getSandbox: async (): Promise<Sandbox> => {
        throw new SandboxNotFoundError("sb-gone");
      },
    };

    const handler = async (): Promise<ToolHandlerResponse<null>> => ({
      toolResponse: "ok",
      data: null,
    });

    const wrapped = withSandbox(manager, handler, {
      sandboxNotFoundToolResponse: "should not be used",
    });

    await expect(
      wrapped(
        {},
        {
          threadId: "t",
          toolCallId: "tc",
          toolName: "Bash",
          sandboxId: "sb-gone",
        }
      )
    ).rejects.toBeInstanceOf(SandboxNotFoundError);
  });

  it("does not translate non-SandboxNotFoundError errors when translate option is set", async () => {
    const manager = {
      getSandbox: async (): Promise<Sandbox> => {
        throw new Error("network down");
      },
    };

    const handler = async (): Promise<ToolHandlerResponse<null>> => ({
      toolResponse: "ok",
      data: null,
    });

    const wrapped = withSandbox(manager, handler, {
      translateSandboxNotFound: true,
    });

    await expect(
      wrapped(
        {},
        {
          threadId: "t",
          toolCallId: "tc",
          toolName: "Bash",
          sandboxId: "sb-gone",
        }
      )
    ).rejects.toThrow("network down");
  });

  it("passes all RouterContext fields through to inner handler", async () => {
    const mockSandbox = createMockSandbox();
    const manager = { getSandbox: async () => mockSandbox };

    let capturedCtx:
      | (RouterContext & { sandbox: Sandbox; sandboxId: string })
      | null = null;

    const handler = async (
      _args: unknown,
      ctx: RouterContext & { sandbox: Sandbox; sandboxId: string }
    ): Promise<ToolHandlerResponse<null>> => {
      capturedCtx = ctx;
      return { toolResponse: "ok", data: null };
    };

    const wrapped = withSandbox(manager, handler);

    await wrapped(
      {},
      {
        threadId: "my-thread",
        toolCallId: "my-tc",
        toolName: "MyTool",
        sandboxId: "my-sandbox",
      }
    );

    expect(capturedCtx).toEqual(
      expect.objectContaining({
        threadId: "my-thread",
        toolCallId: "my-tc",
        toolName: "MyTool",
        sandboxId: "my-sandbox",
        sandbox: mockSandbox,
      })
    );
  });

  it("handles sandboxId with empty string as falsy", async () => {
    const manager = { getSandbox: vi.fn() };

    const handler = async (): Promise<ToolHandlerResponse<null>> => ({
      toolResponse: "nope",
      data: null,
    });

    const wrapped = withSandbox(manager, handler);

    const result = await wrapped(
      {},
      {
        threadId: "t",
        toolCallId: "tc",
        toolName: "Test",
        sandboxId: "",
      }
    );

    expect(result.toolResponse).toContain("No sandbox configured");
    expect(manager.getSandbox).not.toHaveBeenCalled();
  });
});
