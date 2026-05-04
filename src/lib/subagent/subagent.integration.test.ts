import { describe, expect, it, vi, afterEach } from "vitest";
import { z } from "zod";

let nextStartChildResult: ((prompt: string) => unknown) | null = null;

vi.mock("@temporalio/workflow", () => {
  let counter = 0;

  class MockApplicationFailure extends Error {
    nonRetryable?: boolean;
    static create({
      message,
      nonRetryable,
    }: {
      message: string;
      nonRetryable?: boolean;
    }) {
      const err = new MockApplicationFailure(message);
      err.nonRetryable = nonRetryable;
      return err;
    }
    static fromError(error: unknown) {
      const src = error instanceof Error ? error : new Error(String(error));
      return new MockApplicationFailure(src.message);
    }
  }

  return {
    workflowInfo: () => ({
      taskQueue: "default-queue",
      workflowId: "child-wf-1",
      parent: { workflowId: "parent-wf-1" },
    }),
    defineSignal: vi.fn((name: string) => ({ __signal: true, name })),
    setHandler: vi.fn(),
    condition: vi.fn(async (fn: () => boolean) => {
      if (!fn()) throw new Error("condition predicate was not satisfied");
    }),
    executeChild: vi.fn(
      async (
        _workflow: unknown,
        opts: { workflowId: string; args: unknown[] }
      ) => {
        const prompt = (opts.args as [string])[0];
        const result = nextStartChildResult
          ? nextStartChildResult(prompt)
          : {
              toolResponse: `Response to: ${prompt}`,
              data: { result: "child-data" },
              threadId: "child-thread-1",
              usage: { inputTokens: 100, outputTokens: 50 },
            };

        return result;
      }
    ),
    getExternalWorkflowHandle: vi.fn((_id: string) => ({
      signal: vi.fn(),
    })),
    ApplicationFailure: MockApplicationFailure,
    uuid4: () => {
      counter++;
      const bytes = Array.from({ length: 16 }, (_, i) =>
        ((counter * 31 + i * 7) & 0xff).toString(16).padStart(2, "0")
      ).join("");
      return `${bytes.slice(0, 8)}-${bytes.slice(8, 12)}-${bytes.slice(12, 16)}-${bytes.slice(16, 20)}-${bytes.slice(20, 32)}`;
    },
    log: {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  };
});

import { createSubagentTool, SUBAGENT_TOOL_NAME } from "./tool";
import { createSubagentHandler } from "./handler";
import { buildSubagentRegistration } from "./register";
import { defineSubagentWorkflow } from "./workflow";
import { defineSubagent } from "./define";
import type {
  SubagentConfig,
  SubagentSessionInput,
  SubagentWorkflow,
  SubagentWorkflowInput,
} from "./types";
afterEach(() => {
  nextStartChildResult = null;
});

function mockWorkflow(name?: string): SubagentWorkflow {
  const fn = async () => ({
    toolResponse: "ok",
    data: null,
    threadId: "t-1",
  });
  if (name) Object.defineProperty(fn, "name", { value: name });
  return fn as SubagentWorkflow;
}

function makeMockSandboxOps() {
  return {
    createSandbox: vi.fn(),
    destroySandbox: vi.fn(),
    pauseSandbox: vi.fn(),
    resumeSandbox: vi.fn(),
    snapshotSandbox: vi.fn(),
    restoreSandbox: vi.fn(),
    deleteSandboxSnapshot: vi.fn(),
    forkSandbox: vi.fn(),
  };
}

/**
 * Default no-op sandbox proxy factory — satisfies the runtime check that
 * every sandbox-using subagent must declare `sandbox.proxy`. Tests that
 * need to assert on destroy/cleanup create their own mock ops and wire
 * them through `sandbox: { ..., proxy: () => opsMock }`.
 */
const noopSandboxProxy = () => makeMockSandboxOps();

// ---------------------------------------------------------------------------
// createSubagentTool
// ---------------------------------------------------------------------------

describe("createSubagentTool", () => {
  it("creates tool with correct name and schema for single subagent", () => {
    const tool = createSubagentTool([
      {
        agentName: "researcher",
        description: "Researches topics",
        workflow: mockWorkflow(),
      },
    ]);

    expect(tool.name).toBe(SUBAGENT_TOOL_NAME);
    expect(tool.description).toContain("researcher");
    expect(tool.description).toContain("Researches topics");

    const valid = tool.schema.safeParse({
      subagent: "researcher",
      description: "Research something",
      prompt: "Find info about X",
    });
    expect(valid.success).toBe(true);
  });

  it("creates enum schema for multiple subagents", () => {
    const tool = createSubagentTool([
      {
        agentName: "researcher",
        description: "Researches",
        workflow: mockWorkflow(),
      },
      {
        agentName: "writer",
        description: "Writes",
        workflow: mockWorkflow(),
      },
    ]);

    expect(
      tool.schema.safeParse({
        subagent: "researcher",
        description: "d",
        prompt: "p",
      }).success
    ).toBe(true);
    expect(
      tool.schema.safeParse({
        subagent: "writer",
        description: "d",
        prompt: "p",
      }).success
    ).toBe(true);
    expect(
      tool.schema.safeParse({
        subagent: "nonexistent",
        description: "d",
        prompt: "p",
      }).success
    ).toBe(false);
  });

  it("adds threadId field when thread mode allows continuation", () => {
    const tool = createSubagentTool([
      {
        agentName: "agent",
        description: "supports continuation",
        workflow: mockWorkflow(),
        thread: "fork",
      },
    ]);

    expect(
      tool.schema.safeParse({
        subagent: "agent",
        description: "d",
        prompt: "p",
        threadId: "some-thread",
      }).success
    ).toBe(true);

    expect(
      tool.schema.safeParse({
        subagent: "agent",
        description: "d",
        prompt: "p",
        threadId: null,
      }).success
    ).toBe(true);
  });

  it("does not include threadId field when thread mode is new", () => {
    const tool = createSubagentTool([
      {
        agentName: "basic",
        description: "basic agent",
        workflow: mockWorkflow(),
      },
    ]);

    const result = tool.schema.safeParse({
      subagent: "basic",
      description: "d",
      prompt: "p",
      threadId: "should-strip",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("threadId");
    }
  });

  it("throws when no subagents are provided", () => {
    expect(() => createSubagentTool([])).toThrow(
      "createSubagentTool requires at least one subagent"
    );
  });

  it("includes thread continuation note in description", () => {
    const tool = createSubagentTool([
      {
        agentName: "cont-agent",
        description: "Supports continuation",
        workflow: mockWorkflow(),
        thread: "fork",
      },
    ]);

    expect(tool.description).toContain("thread continuation");
  });
});

// ---------------------------------------------------------------------------
// createSubagentHandler
// ---------------------------------------------------------------------------

describe("createSubagentHandler", () => {
  const basicSubagent: SubagentConfig = {
    agentName: "researcher",
    description: "Researches topics",
    workflow: mockWorkflow("researcherWorkflow"),
  };

  it("executes child workflow and returns response", async () => {
    const { handler } = createSubagentHandler([basicSubagent]);

    const result = await handler(
      { subagent: "researcher", description: "test", prompt: "Find info" },
      { threadId: "parent-thread", toolCallId: "tc-1", toolName: "Subagent" }
    );

    expect(result.toolResponse).toContain("Response to: Find info");
    expect(result.data).toEqual({ result: "child-data" });
  });

  it("throws for unknown subagent name", async () => {
    const { handler } = createSubagentHandler([basicSubagent]);

    await expect(
      handler(
        { subagent: "nonexistent", description: "test", prompt: "test" },
        { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
      )
    ).rejects.toThrow("Unknown subagent: nonexistent");
  });

  it("includes available subagent names in error message", async () => {
    const { handler } = createSubagentHandler([
      basicSubagent,
      {
        agentName: "writer",
        description: "Writes",
        workflow: mockWorkflow("writerWorkflow"),
      },
    ]);

    await expect(
      handler(
        { subagent: "bad", description: "test", prompt: "test" },
        { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
      )
    ).rejects.toThrow(/researcher.*writer/);
  });

  it("validates result against resultSchema", async () => {
    nextStartChildResult = () => ({
      toolResponse: "result",
      data: { invalid: "data" },
      threadId: "child-t",
    });

    const validatedSubagent: SubagentConfig = {
      agentName: "validated",
      description: "Has validation",
      workflow: mockWorkflow(),
      resultSchema: z.object({ expected: z.string() }),
    };

    const { handler } = createSubagentHandler([validatedSubagent]);

    const result = await handler(
      { subagent: "validated", description: "test", prompt: "test" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    expect(result.toolResponse).toContain("invalid data");
    expect(result.data).toBeNull();
  });

  it("appends thread ID when thread is fork", async () => {
    nextStartChildResult = () => ({
      toolResponse: "Some response",
      data: null,
      threadId: "child-thread-99",
    });

    const contSubagent: SubagentConfig = {
      agentName: "cont",
      description: "Continues threads",
      workflow: mockWorkflow(),
      thread: "fork",
    };

    const { handler } = createSubagentHandler([contSubagent]);

    const result = await handler(
      { subagent: "cont", description: "test", prompt: "test" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    expect(result.toolResponse).toContain("Thread ID: child-thread-99");
  });

  it("returns fallback when child workflow returns no toolResponse", async () => {
    nextStartChildResult = () => ({
      toolResponse: null,
      data: null,
      threadId: "child-t",
    });

    const { handler } = createSubagentHandler([basicSubagent]);

    const result = await handler(
      { subagent: "researcher", description: "test", prompt: "test" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    expect(result.toolResponse).toContain("no response");
    expect(result.data).toBeNull();
  });

  it("passes sandbox inherit to child when sandbox is inherit", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    const inheritSubagent: SubagentConfig = {
      agentName: "inherit-agent",
      description: "Inherits sandbox",
      workflow: mockWorkflow(),
      sandbox: {
        source: "inherit",
        continuation: "continue",
        proxy: noopSandboxProxy,
      },
    };

    const { handler } = createSubagentHandler([inheritSubagent]);

    await handler(
      { subagent: "inherit-agent", description: "test", prompt: "test" },
      {
        threadId: "t",
        toolCallId: "tc",
        toolName: "Subagent",
        sandboxId: "parent-sb",
      }
    );

    const lastCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected executeChild call");
    const workflowInput = lastCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.sandbox).toEqual({
      mode: "inherit",
      sandboxId: "parent-sb",
    });
  });

  it("throws when sandbox is inherit but parent has no sandbox", async () => {
    const inheritSubagent: SubagentConfig = {
      agentName: "inherit-agent",
      description: "Inherits sandbox",
      workflow: mockWorkflow(),
      sandbox: {
        source: "inherit",
        continuation: "continue",
        proxy: noopSandboxProxy,
      },
    };

    const { handler } = createSubagentHandler([inheritSubagent]);

    await expect(
      handler(
        { subagent: "inherit-agent", description: "test", prompt: "test" },
        { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
      )
    ).rejects.toThrow('sandbox: "inherit" but the parent has no sandbox');
  });

  it("does not pass sandboxId to child when sandbox is own (first call)", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    const ownSubagent: SubagentConfig = {
      agentName: "own-agent",
      description: "Own sandbox",
      workflow: mockWorkflow(),
      sandbox: { source: "own", continuation: "fork", proxy: noopSandboxProxy },
    };

    const { handler } = createSubagentHandler([ownSubagent]);

    await handler(
      { subagent: "own-agent", description: "test", prompt: "test" },
      {
        threadId: "t",
        toolCallId: "tc",
        toolName: "Subagent",
        sandboxId: "parent-sb",
      }
    );

    const lastCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected executeChild call");
    const workflowInput = lastCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.sandbox).toBeUndefined();
  });

  it("resolves context function at invocation time", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    let counter = 0;
    const dynamicSubagent: SubagentConfig = {
      agentName: "dynamic-ctx",
      description: "Dynamic context",
      workflow: mockWorkflow(),
      context: () => {
        counter++;
        return { invocation: counter };
      },
    };

    const { handler } = createSubagentHandler([dynamicSubagent]);

    await handler(
      { subagent: "dynamic-ctx", description: "test", prompt: "test" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    const lastCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected executeChild call");
    const context = lastCall[1].args[2] as Record<string, unknown>;
    expect(context).toEqual({ invocation: 1 });
  });

  it("passes static context unchanged", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    const staticSubagent: SubagentConfig = {
      agentName: "static-ctx",
      description: "Static context",
      workflow: mockWorkflow(),
      context: { key: "value" },
    };

    const { handler } = createSubagentHandler([staticSubagent]);

    await handler(
      { subagent: "static-ctx", description: "test", prompt: "test" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    const lastCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected executeChild call");
    const context = lastCall[1].args[2] as Record<string, unknown>;
    expect(context).toEqual({ key: "value" });
  });

  it("does not pass sandbox init when sandbox is own without prior sandbox", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    const ownSubagent: SubagentConfig = {
      agentName: "own-agent",
      description: "Own sandbox",
      workflow: mockWorkflow(),
      sandbox: { source: "own", continuation: "fork", proxy: noopSandboxProxy },
    };

    const { handler } = createSubagentHandler([ownSubagent]);

    await handler(
      { subagent: "own-agent", description: "test", prompt: "test" },
      {
        threadId: "t",
        toolCallId: "tc",
        toolName: "Subagent",
        sandboxId: "parent-sb",
      }
    );

    const lastCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected executeChild call");
    const workflowInput = lastCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.sandbox).toBeUndefined();
  });

  // --- Thread mode ---

  it("passes thread fork when thread is fork and threadId provided", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    const contSubagent: SubagentConfig = {
      agentName: "cont",
      description: "Continues",
      workflow: mockWorkflow(),
      thread: "fork",
    };

    const { handler } = createSubagentHandler([contSubagent]);

    await handler(
      {
        subagent: "cont",
        description: "test",
        prompt: "test",
        threadId: "prev-thread-42",
      },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    const lastCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected executeChild call");
    const workflowInput = lastCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.thread).toEqual({
      mode: "fork",
      threadId: "prev-thread-42",
    });
  });

  it("passes thread continue when thread is continue", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    const contSubagent: SubagentConfig = {
      agentName: "cont-mode",
      description: "Continue mode",
      workflow: mockWorkflow(),
      thread: "continue",
    };

    const { handler } = createSubagentHandler([contSubagent]);

    await handler(
      {
        subagent: "cont-mode",
        description: "test",
        prompt: "test",
        threadId: "prev-thread-99",
      },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    const lastCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected executeChild call");
    const workflowInput = lastCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.thread).toEqual({
      mode: "continue",
      threadId: "prev-thread-99",
    });
  });

  it("does not pass thread when thread is new", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    const noContSubagent: SubagentConfig = {
      agentName: "no-cont",
      description: "No continuation",
      workflow: mockWorkflow(),
    };

    const { handler } = createSubagentHandler([noContSubagent]);

    await handler(
      {
        subagent: "no-cont",
        description: "test",
        prompt: "test",
        threadId: "prev-thread",
      },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    const lastCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected executeChild call");
    const workflowInput = lastCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.thread).toBeUndefined();
  });

  // --- Sandbox continuation ---

  it("does not pass sandbox when thread is fork (own sandbox)", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    const contSandboxSubagent: SubagentConfig = {
      agentName: "sb-cont",
      description: "Sandbox continuation",
      workflow: mockWorkflow(),
      thread: "fork",
    };

    const { handler } = createSubagentHandler([contSandboxSubagent]);

    await handler(
      { subagent: "sb-cont", description: "test", prompt: "first run" },
      {
        threadId: "t",
        toolCallId: "tc",
        toolName: "Subagent",
        sandboxId: "parent-sb",
      }
    );

    const lastCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected executeChild call");
    const workflowInput = lastCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.sandbox).toBeUndefined();
  });

  it("tracks sandbox ID and passes sandbox fork on continuation", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    nextStartChildResult = () => ({
      toolResponse: "first run done",
      data: null,
      threadId: "child-thread-A",
      sandboxId: "child-sb-1",
    });

    const contSandboxSubagent: SubagentConfig = {
      agentName: "sb-cont",
      description: "Sandbox continuation",
      workflow: mockWorkflow(),
      thread: "fork",
      sandbox: { source: "own", continuation: "fork", proxy: noopSandboxProxy },
    };

    const { handler } = createSubagentHandler([contSandboxSubagent]);

    await handler(
      { subagent: "sb-cont", description: "test", prompt: "first" },
      { threadId: "t", toolCallId: "tc-1", toolName: "Subagent" }
    );

    nextStartChildResult = () => ({
      toolResponse: "second run done",
      data: null,
      threadId: "child-thread-B",
      sandboxId: "child-sb-2",
    });

    await handler(
      {
        subagent: "sb-cont",
        description: "test",
        prompt: "second",
        threadId: "child-thread-A",
      },
      { threadId: "t", toolCallId: "tc-2", toolName: "Subagent" }
    );

    const secondCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!secondCall) throw new Error("expected second executeChild call");
    const workflowInput = secondCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.thread).toEqual({
      mode: "fork",
      threadId: "child-thread-A",
    });
    expect(workflowInput.sandbox).toEqual({
      mode: "fork",
      sandboxId: "child-sb-1",
    });
  });

  it("does not pass sandbox fork without thread continuation", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    nextStartChildResult = () => ({
      toolResponse: "done",
      data: null,
      threadId: "child-thread-A",
      sandboxId: "child-sb-1",
    });

    const contSandboxSubagent: SubagentConfig = {
      agentName: "sb-cont",
      description: "Sandbox continuation",
      workflow: mockWorkflow(),
      thread: "fork",
      sandbox: { source: "own", continuation: "fork", proxy: noopSandboxProxy },
    };

    const { handler } = createSubagentHandler([contSandboxSubagent]);

    await handler(
      { subagent: "sb-cont", description: "test", prompt: "first" },
      { threadId: "t", toolCallId: "tc-1", toolName: "Subagent" }
    );

    nextStartChildResult = () => ({
      toolResponse: "new run",
      data: null,
      threadId: "child-thread-B",
      sandboxId: "child-sb-2",
    });

    await handler(
      { subagent: "sb-cont", description: "test", prompt: "no continuation" },
      { threadId: "t", toolCallId: "tc-2", toolName: "Subagent" }
    );

    const secondCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!secondCall) throw new Error("expected executeChild call");
    const workflowInput = secondCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.sandbox).toBeUndefined();
    expect(workflowInput.thread).toBeUndefined();
  });

  it("does not destroy fork-mode subagent sandbox without pause-until-parent-close", async () => {
    const contSandboxSubagent: SubagentConfig = {
      agentName: "sb-cont",
      description: "Sandbox continuation",
      workflow: mockWorkflow(),
      thread: "fork",
    };

    const { handler, destroySubagentSandboxes } = createSubagentHandler([
      contSandboxSubagent,
    ]);

    await handler(
      { subagent: "sb-cont", description: "test", prompt: "run" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    await expect(destroySubagentSandboxes()).resolves.toBeUndefined();
  });

  it("does not destroy sandbox=own with default shutdown", async () => {
    const opsMock = makeMockSandboxOps();
    const ownSubagent: SubagentConfig = {
      agentName: "own-agent",
      description: "Own sandbox",
      workflow: mockWorkflow(),
      sandbox: { source: "own", continuation: "fork", proxy: () => opsMock },
    };

    const { handler, destroySubagentSandboxes } = createSubagentHandler([
      ownSubagent,
    ]);

    await handler(
      { subagent: "own-agent", description: "test", prompt: "run" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    await destroySubagentSandboxes();

    expect(opsMock.destroySandbox).not.toHaveBeenCalled();
  });

  it("destroys sandbox via sandbox.proxy for own + pause-until-parent-close", async () => {
    nextStartChildResult = () => ({
      toolResponse: "done",
      data: null,
      threadId: "child-t",
      sandboxId: "child-sb-99",
    });

    const opsMock = makeMockSandboxOps();
    const ownSubagent: SubagentConfig = {
      agentName: "own-agent",
      description: "Own sandbox",
      workflow: mockWorkflow(),
      sandbox: {
        source: "own",
        continuation: "fork",
        shutdown: "pause-until-parent-close",
        proxy: () => opsMock,
      },
    };

    const { handler, destroySubagentSandboxes } = createSubagentHandler([
      ownSubagent,
    ]);

    await handler(
      { subagent: "own-agent", description: "test", prompt: "run" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    await destroySubagentSandboxes();

    expect(opsMock.destroySandbox).toHaveBeenCalledWith("child-sb-99");
  });

  it("does not destroy inherit subagents' sandbox", async () => {
    const opsMock = makeMockSandboxOps();
    const inheritSubagent: SubagentConfig = {
      agentName: "inherit-agent",
      description: "Inherits sandbox",
      workflow: mockWorkflow(),
      sandbox: {
        source: "inherit",
        continuation: "continue",
        proxy: () => opsMock,
      },
    };

    const { handler, destroySubagentSandboxes } = createSubagentHandler([
      inheritSubagent,
    ]);

    await handler(
      { subagent: "inherit-agent", description: "test", prompt: "run" },
      {
        threadId: "t",
        toolCallId: "tc",
        toolName: "Subagent",
        sandboxId: "parent-sb",
      }
    );

    await destroySubagentSandboxes();

    expect(opsMock.destroySandbox).not.toHaveBeenCalled();
  });

  it("does not pass sandboxId when sandbox is none (default)", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    const noneSubagent: SubagentConfig = {
      agentName: "none-agent",
      description: "No sandbox",
      workflow: mockWorkflow(),
    };

    const { handler } = createSubagentHandler([noneSubagent]);

    await handler(
      { subagent: "none-agent", description: "test", prompt: "test" },
      {
        threadId: "t",
        toolCallId: "tc",
        toolName: "Subagent",
        sandboxId: "parent-sb",
      }
    );

    const lastCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected executeChild call");
    const workflowInput = lastCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.sandbox).toBeUndefined();
  });

  it("does not pass sandboxId when sandbox is explicitly none", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    const noneSubagent: SubagentConfig = {
      agentName: "none-agent",
      description: "No sandbox",
      workflow: mockWorkflow(),
      sandbox: "none",
    };

    const { handler } = createSubagentHandler([noneSubagent]);

    await handler(
      { subagent: "none-agent", description: "test", prompt: "test" },
      {
        threadId: "t",
        toolCallId: "tc",
        toolName: "Subagent",
        sandboxId: "parent-sb",
      }
    );

    const lastCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected executeChild call");
    const workflowInput = lastCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.sandbox).toBeUndefined();
  });

  it("destroySubagentSandboxes is a no-op for none subagents", async () => {
    const noneSubagent: SubagentConfig = {
      agentName: "none-agent",
      description: "No sandbox",
      workflow: mockWorkflow(),
      sandbox: "none",
    };

    const { handler, destroySubagentSandboxes } = createSubagentHandler([
      noneSubagent,
    ]);

    await handler(
      { subagent: "none-agent", description: "test", prompt: "run" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    await expect(destroySubagentSandboxes()).resolves.toBeUndefined();
  });

  // --- inherit + continuation: fork ---

  it("forks from parent sandbox when inherit + continuation=fork", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    const config: SubagentConfig = {
      agentName: "inherit-fork",
      description: "Inherit fork",
      workflow: mockWorkflow(),
      sandbox: {
        source: "inherit",
        continuation: "fork",
        proxy: noopSandboxProxy,
      },
    };

    const { handler } = createSubagentHandler([config]);

    await handler(
      { subagent: "inherit-fork", description: "test", prompt: "test" },
      {
        threadId: "t",
        toolCallId: "tc",
        toolName: "Subagent",
        sandboxId: "parent-sb",
      }
    );

    const lastCall = execMock.mock.calls.at(-1);
    if (!lastCall) throw new Error("expected executeChild call");
    const workflowInput = lastCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.sandbox).toEqual({
      mode: "fork",
      sandboxId: "parent-sb",
    });
  });

  // --- own + continuation: continue ---

  it("passes sandbox continue on thread continuation with continuation=continue", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    nextStartChildResult = () => ({
      toolResponse: "first",
      data: null,
      threadId: "child-t-1",
      sandboxId: "child-sb-1",
    });

    const config: SubagentConfig = {
      agentName: "own-cont",
      description: "Own continue",
      workflow: mockWorkflow(),
      thread: "continue",
      sandbox: {
        source: "own",
        continuation: "continue",
        proxy: noopSandboxProxy,
      },
    };

    const { handler } = createSubagentHandler([config]);

    await handler(
      { subagent: "own-cont", description: "test", prompt: "first" },
      { threadId: "t", toolCallId: "tc-1", toolName: "Subagent" }
    );

    nextStartChildResult = () => ({
      toolResponse: "second",
      data: null,
      threadId: "child-t-1",
      sandboxId: "child-sb-1",
    });

    await handler(
      {
        subagent: "own-cont",
        description: "test",
        prompt: "second",
        threadId: "child-t-1",
      },
      { threadId: "t", toolCallId: "tc-2", toolName: "Subagent" }
    );

    const secondCall = execMock.mock.calls.at(-1);
    if (!secondCall) throw new Error("expected executeChild call");
    const workflowInput = secondCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.sandbox).toEqual({
      mode: "continue",
      sandboxId: "child-sb-1",
    });
    expect(workflowInput.sandboxShutdown).toBe("pause");
  });

  // --- own + init: once + continuation: fork ---

  it("stores sandbox on first call and forks from it on second call (init=once, continuation=fork)", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    nextStartChildResult = () => ({
      toolResponse: "first",
      data: null,
      threadId: "child-t-1",
      sandboxId: "persistent-sb",
    });

    const config: SubagentConfig = {
      agentName: "lazy-fork",
      description: "Lazy fork",
      workflow: mockWorkflow(),
      sandbox: {
        source: "own",
        init: "once",
        continuation: "fork",
        proxy: noopSandboxProxy,
      },
    };

    const { handler } = createSubagentHandler([config]);

    await handler(
      { subagent: "lazy-fork", description: "test", prompt: "first" },
      { threadId: "t", toolCallId: "tc-1", toolName: "Subagent" }
    );

    // First call: no sandbox init (child creates fresh), forced pause-until-parent-close
    const firstCall = execMock.mock.calls.at(-1);
    if (!firstCall) throw new Error("expected executeChild call");
    const firstInput = firstCall[1].args[1] as SubagentWorkflowInput;
    expect(firstInput.sandbox).toBeUndefined();
    expect(firstInput.sandboxShutdown).toBe("pause-until-parent-close");

    nextStartChildResult = () => ({
      toolResponse: "second",
      data: null,
      threadId: "child-t-2",
      sandboxId: "forked-sb",
    });

    // Second call WITHOUT threadId — should still fork from persistent sandbox
    await handler(
      { subagent: "lazy-fork", description: "test", prompt: "second" },
      { threadId: "t", toolCallId: "tc-2", toolName: "Subagent" }
    );

    const secondCall = execMock.mock.calls.at(-1);
    if (!secondCall) throw new Error("expected executeChild call");
    const secondInput = secondCall[1].args[1] as SubagentWorkflowInput;
    expect(secondInput.sandbox).toEqual({
      mode: "fork",
      sandboxId: "persistent-sb",
    });
  });

  // --- own + init: once + continuation: continue ---

  it("stores sandbox on first call and continues it on second call (init=once, continuation=continue)", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    nextStartChildResult = () => ({
      toolResponse: "first",
      data: null,
      threadId: "child-t-1",
      sandboxId: "persistent-sb",
    });

    const config: SubagentConfig = {
      agentName: "lazy-cont",
      description: "Lazy continue",
      workflow: mockWorkflow(),
      sandbox: {
        source: "own",
        init: "once",
        continuation: "continue",
        proxy: noopSandboxProxy,
      },
    };

    const { handler } = createSubagentHandler([config]);

    await handler(
      { subagent: "lazy-cont", description: "test", prompt: "first" },
      { threadId: "t", toolCallId: "tc-1", toolName: "Subagent" }
    );

    nextStartChildResult = () => ({
      toolResponse: "second",
      data: null,
      threadId: "child-t-2",
      sandboxId: "persistent-sb",
    });

    await handler(
      { subagent: "lazy-cont", description: "test", prompt: "second" },
      { threadId: "t", toolCallId: "tc-2", toolName: "Subagent" }
    );

    const secondCall = execMock.mock.calls.at(-1);
    if (!secondCall) throw new Error("expected executeChild call");
    const secondInput = secondCall[1].args[1] as SubagentWorkflowInput;
    expect(secondInput.sandbox).toEqual({
      mode: "continue",
      sandboxId: "persistent-sb",
    });
    expect(secondInput.sandboxShutdown).toBe("pause");
  });

  // --- init: once cleanup ---

  it("destroys the persistent sandbox for init=once at parent shutdown", async () => {
    nextStartChildResult = () => ({
      toolResponse: "done",
      data: null,
      threadId: "child-t-1",
      sandboxId: "persistent-sb",
    });

    const opsMock = makeMockSandboxOps();
    const config: SubagentConfig = {
      agentName: "lazy-cleanup",
      description: "Lazy cleanup",
      workflow: mockWorkflow(),
      sandbox: {
        source: "own",
        init: "once",
        continuation: "fork",
        proxy: () => opsMock,
      },
    };

    const { handler, destroySubagentSandboxes } = createSubagentHandler([
      config,
    ]);

    await handler(
      { subagent: "lazy-cleanup", description: "test", prompt: "run" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    await destroySubagentSandboxes();

    expect(opsMock.destroySandbox).toHaveBeenCalledWith("persistent-sb");
  });

  it("returns sandboxId in response when child creates a sandbox", async () => {
    nextStartChildResult = () => ({
      toolResponse: "done",
      data: null,
      threadId: "child-t",
      sandboxId: "child-sb-42",
    });

    const ownSubagent: SubagentConfig = {
      agentName: "own-agent",
      description: "Own sandbox",
      workflow: mockWorkflow(),
      sandbox: { source: "own", continuation: "fork", proxy: noopSandboxProxy },
    };

    const { handler } = createSubagentHandler([ownSubagent]);

    const result = await handler(
      { subagent: "own-agent", description: "test", prompt: "test" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    expect(result.sandboxId).toBe("child-sb-42");
  });

  it("does not include sandboxId in response when child has none", async () => {
    nextStartChildResult = () => ({
      toolResponse: "done",
      data: null,
      threadId: "child-t",
    });

    const { handler } = createSubagentHandler([basicSubagent]);

    const result = await handler(
      { subagent: "researcher", description: "test", prompt: "test" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    expect(result.sandboxId).toBeUndefined();
  });

  it("passes metadata through on success", async () => {
    nextStartChildResult = () => ({
      toolResponse: "result",
      data: { result: "ok" },
      threadId: "child-t",
      metadata: { jobId: "j-123", env: "staging" },
    });

    const { handler } = createSubagentHandler([basicSubagent]);

    const result = await handler(
      { subagent: "researcher", description: "test", prompt: "test" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    expect(result.metadata).toEqual({ jobId: "j-123", env: "staging" });
  });

  it("passes metadata through when toolResponse is null", async () => {
    nextStartChildResult = () => ({
      toolResponse: null,
      data: null,
      threadId: "child-t",
      metadata: { state: "pending" },
    });

    const { handler } = createSubagentHandler([basicSubagent]);

    const result = await handler(
      { subagent: "researcher", description: "test", prompt: "test" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    expect(result.toolResponse).toContain("no response");
    expect(result.metadata).toEqual({ state: "pending" });
  });

  it("passes metadata through when validation fails", async () => {
    nextStartChildResult = () => ({
      toolResponse: "result",
      data: { wrong: "shape" },
      threadId: "child-t",
      metadata: { deployId: "d-456" },
    });

    const validatedSubagent: SubagentConfig = {
      agentName: "validated",
      description: "Has validation",
      workflow: mockWorkflow(),
      resultSchema: z.object({ expected: z.string() }),
    };

    const { handler } = createSubagentHandler([validatedSubagent]);

    const result = await handler(
      { subagent: "validated", description: "test", prompt: "test" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    expect(result.toolResponse).toContain("invalid data");
    expect(result.data).toBeNull();
    expect(result.metadata).toEqual({ deployId: "d-456" });
  });

  it("omits metadata when child does not return it", async () => {
    nextStartChildResult = () => ({
      toolResponse: "result",
      data: null,
      threadId: "child-t",
    });

    const { handler } = createSubagentHandler([basicSubagent]);

    const result = await handler(
      { subagent: "researcher", description: "test", prompt: "test" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    expect(result.metadata).toBeUndefined();
  });

  // --- keep-until-parent-close ---

  it("destroys sandbox for own + keep-until-parent-close", async () => {
    nextStartChildResult = () => ({
      toolResponse: "done",
      data: null,
      threadId: "child-t",
      sandboxId: "child-sb-77",
    });

    const opsMock = makeMockSandboxOps();
    const ownSubagent: SubagentConfig = {
      agentName: "own-keep",
      description: "Own sandbox kept",
      workflow: mockWorkflow(),
      sandbox: {
        source: "own",
        continuation: "fork",
        shutdown: "keep-until-parent-close",
        proxy: () => opsMock,
      },
    };

    const { handler, destroySubagentSandboxes } = createSubagentHandler([
      ownSubagent,
    ]);

    await handler(
      { subagent: "own-keep", description: "test", prompt: "run" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    await destroySubagentSandboxes();

    expect(opsMock.destroySandbox).toHaveBeenCalledWith("child-sb-77");
  });

  it("does not destroy sandbox for own + keep (without parent-close)", async () => {
    const opsMock = makeMockSandboxOps();
    const ownSubagent: SubagentConfig = {
      agentName: "own-keep-plain",
      description: "Own sandbox keep",
      workflow: mockWorkflow(),
      sandbox: {
        source: "own",
        continuation: "fork",
        shutdown: "keep",
        proxy: () => opsMock,
      },
    };

    const { handler, destroySubagentSandboxes } = createSubagentHandler([
      ownSubagent,
    ]);

    await handler(
      { subagent: "own-keep-plain", description: "test", prompt: "run" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    await destroySubagentSandboxes();

    expect(opsMock.destroySandbox).not.toHaveBeenCalled();
  });

  // --- mustSurvive does not override user shutdown ---

  it("does not override keep-until-parent-close with pause-until-parent-close for init=once", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    nextStartChildResult = () => ({
      toolResponse: "first",
      data: null,
      threadId: "child-t-1",
      sandboxId: "persistent-sb",
    });

    const config: SubagentConfig = {
      agentName: "lazy-keep",
      description: "Lazy keep",
      workflow: mockWorkflow(),
      sandbox: {
        source: "own",
        init: "once",
        continuation: "fork",
        shutdown: "keep-until-parent-close",
        proxy: noopSandboxProxy,
      },
    };

    const { handler } = createSubagentHandler([config]);

    await handler(
      { subagent: "lazy-keep", description: "test", prompt: "first" },
      { threadId: "t", toolCallId: "tc-1", toolName: "Subagent" }
    );

    const firstCall = execMock.mock.calls.at(-1);
    if (!firstCall) throw new Error("expected executeChild call");
    const firstInput = firstCall[1].args[1] as SubagentWorkflowInput;
    expect(firstInput.sandboxShutdown).toBe("keep-until-parent-close");
  });

  it("does not override pause with pause-until-parent-close for init=once", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    nextStartChildResult = () => ({
      toolResponse: "first",
      data: null,
      threadId: "child-t-1",
      sandboxId: "persistent-sb",
    });

    const config: SubagentConfig = {
      agentName: "lazy-pause",
      description: "Lazy pause",
      workflow: mockWorkflow(),
      sandbox: {
        source: "own",
        init: "once",
        continuation: "fork",
        shutdown: "pause",
        proxy: noopSandboxProxy,
      },
    };

    const { handler } = createSubagentHandler([config]);

    await handler(
      { subagent: "lazy-pause", description: "test", prompt: "first" },
      { threadId: "t", toolCallId: "tc-1", toolName: "Subagent" }
    );

    const firstCall = execMock.mock.calls.at(-1);
    if (!firstCall) throw new Error("expected executeChild call");
    const firstInput = firstCall[1].args[1] as SubagentWorkflowInput;
    expect(firstInput.sandboxShutdown).toBe("pause");
  });

  it("does not override keep with pause for continuation=continue", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    nextStartChildResult = () => ({
      toolResponse: "first",
      data: null,
      threadId: "child-t-1",
      sandboxId: "child-sb-1",
    });

    const config: SubagentConfig = {
      agentName: "cont-keep",
      description: "Continue keep",
      workflow: mockWorkflow(),
      thread: "continue",
      sandbox: {
        source: "own",
        continuation: "continue",
        shutdown: "keep",
        proxy: noopSandboxProxy,
      },
    };

    const { handler } = createSubagentHandler([config]);

    await handler(
      { subagent: "cont-keep", description: "test", prompt: "first" },
      { threadId: "t", toolCallId: "tc-1", toolName: "Subagent" }
    );

    const firstCall = execMock.mock.calls.at(-1);
    if (!firstCall) throw new Error("expected executeChild call");
    const firstInput = firstCall[1].args[1] as SubagentWorkflowInput;
    expect(firstInput.sandboxShutdown).toBe("keep");
  });

  it("still overrides destroy with pause for continuation=continue", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    nextStartChildResult = () => ({
      toolResponse: "first",
      data: null,
      threadId: "child-t-1",
      sandboxId: "child-sb-1",
    });

    const config: SubagentConfig = {
      agentName: "cont-destroy",
      description: "Continue destroy",
      workflow: mockWorkflow(),
      thread: "continue",
      sandbox: {
        source: "own",
        continuation: "continue",
        shutdown: "destroy",
        proxy: noopSandboxProxy,
      },
    };

    const { handler } = createSubagentHandler([config]);

    await handler(
      { subagent: "cont-destroy", description: "test", prompt: "first" },
      { threadId: "t", toolCallId: "tc-1", toolName: "Subagent" }
    );

    const firstCall = execMock.mock.calls.at(-1);
    if (!firstCall) throw new Error("expected executeChild call");
    const firstInput = firstCall[1].args[1] as SubagentWorkflowInput;
    expect(firstInput.sandboxShutdown).toBe("pause");
  });

  // --- snapshot continuation ---

  it("forces sandboxShutdown=snapshot and passes no sandbox on first call (continuation=snapshot)", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    nextStartChildResult = () => ({
      toolResponse: "first",
      data: null,
      threadId: "child-snap-1",
      baseSnapshot: {
        sandboxId: "sb-first",
        providerId: "test",
        data: { tag: "base" },
        createdAt: new Date().toISOString(),
      },
      snapshot: {
        sandboxId: "sb-first",
        providerId: "test",
        data: { tag: "exit-1" },
        createdAt: new Date().toISOString(),
      },
    });

    const config: SubagentConfig = {
      agentName: "snap-agent",
      description: "Snapshot-driven",
      workflow: mockWorkflow(),
      thread: "continue",
      sandbox: {
        source: "own",
        init: "once",
        continuation: "snapshot",
        proxy: noopSandboxProxy,
      },
    };

    const { handler } = createSubagentHandler([config]);

    await handler(
      { subagent: "snap-agent", description: "test", prompt: "first" },
      { threadId: "t", toolCallId: "tc-1", toolName: "Subagent" }
    );

    const firstCall = execMock.mock.calls.at(-1);
    if (!firstCall) throw new Error("expected executeChild call");
    const firstInput = firstCall[1].args[1] as SubagentWorkflowInput;
    expect(firstInput.sandbox).toBeUndefined();
    expect(firstInput.sandboxShutdown).toBe("snapshot");
  });

  it("boots follow-up from stored thread snapshot on continuation=snapshot", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    nextStartChildResult = () => ({
      toolResponse: "first",
      data: null,
      threadId: "child-snap-2",
      baseSnapshot: {
        sandboxId: "sb-first",
        providerId: "test",
        data: { tag: "base" },
        createdAt: new Date().toISOString(),
      },
      snapshot: {
        sandboxId: "sb-first",
        providerId: "test",
        data: { tag: "exit-1" },
        createdAt: new Date().toISOString(),
      },
    });

    const config: SubagentConfig = {
      agentName: "snap-agent",
      description: "Snapshot-driven",
      workflow: mockWorkflow(),
      thread: "continue",
      sandbox: {
        source: "own",
        init: "once",
        continuation: "snapshot",
        proxy: noopSandboxProxy,
      },
    };

    const { handler } = createSubagentHandler([config]);

    await handler(
      { subagent: "snap-agent", description: "test", prompt: "first" },
      { threadId: "t", toolCallId: "tc-1", toolName: "Subagent" }
    );

    nextStartChildResult = () => ({
      toolResponse: "second",
      data: null,
      threadId: "child-snap-2", // same thread — continuation
      snapshot: {
        sandboxId: "sb-second",
        providerId: "test",
        data: { tag: "exit-2" },
        createdAt: new Date().toISOString(),
      },
    });

    await handler(
      {
        subagent: "snap-agent",
        description: "test",
        prompt: "second",
        threadId: "child-snap-2",
      },
      { threadId: "t", toolCallId: "tc-2", toolName: "Subagent" }
    );

    const secondCall = execMock.mock.calls.at(-1);
    if (!secondCall) throw new Error("expected executeChild call");
    const secondInput = secondCall[1].args[1] as SubagentWorkflowInput;
    expect(secondInput.sandbox).toEqual({
      mode: "from-snapshot",
      snapshot: expect.objectContaining({ data: { tag: "exit-1" } }),
    });
    expect(secondInput.sandboxShutdown).toBe("snapshot");
  });

  it("uses per-agent base snapshot for a new thread when init=once + continuation=snapshot", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    // First call — establishes base snapshot.
    nextStartChildResult = () => ({
      toolResponse: "first",
      data: null,
      threadId: "child-snap-A",
      baseSnapshot: {
        sandboxId: "sb-first",
        providerId: "test",
        data: { tag: "base" },
        createdAt: new Date().toISOString(),
      },
      snapshot: {
        sandboxId: "sb-first",
        providerId: "test",
        data: { tag: "exit-A" },
        createdAt: new Date().toISOString(),
      },
    });

    const config: SubagentConfig = {
      agentName: "snap-agent",
      description: "Snapshot-driven",
      workflow: mockWorkflow(),
      thread: "continue",
      sandbox: {
        source: "own",
        init: "once",
        continuation: "snapshot",
        proxy: noopSandboxProxy,
      },
    };

    const { handler } = createSubagentHandler([config]);

    await handler(
      { subagent: "snap-agent", description: "test", prompt: "first" },
      { threadId: "t", toolCallId: "tc-1", toolName: "Subagent" }
    );

    // Third call: different thread → should use base snapshot.
    nextStartChildResult = () => ({
      toolResponse: "new-thread",
      data: null,
      threadId: "child-snap-B",
      snapshot: {
        sandboxId: "sb-B",
        providerId: "test",
        data: { tag: "exit-B" },
        createdAt: new Date().toISOString(),
      },
    });

    await handler(
      { subagent: "snap-agent", description: "test", prompt: "new" },
      { threadId: "t", toolCallId: "tc-2", toolName: "Subagent" }
    );

    const secondCall = execMock.mock.calls.at(-1);
    if (!secondCall) throw new Error("expected executeChild call");
    const secondInput = secondCall[1].args[1] as SubagentWorkflowInput;
    expect(secondInput.sandbox).toEqual({
      mode: "from-snapshot",
      snapshot: expect.objectContaining({ data: { tag: "base" } }),
    });
  });

  it("deletes every stored snapshot via sandbox.proxy during cleanup sweep", async () => {
    const opsMock = makeMockSandboxOps();
    const config: SubagentConfig = {
      agentName: "snap-agent",
      description: "Snapshot-driven",
      workflow: mockWorkflow(),
      thread: "continue",
      sandbox: {
        source: "own",
        init: "once",
        continuation: "snapshot",
        proxy: () => opsMock,
      },
    };

    const { handler, cleanupSubagentSnapshots } = createSubagentHandler([
      config,
    ]);

    // Call 1 — produces base + exit-1.
    nextStartChildResult = () => ({
      toolResponse: "first",
      data: null,
      threadId: "child-t",
      baseSnapshot: {
        sandboxId: "sb-first",
        providerId: "test",
        data: { tag: "base" },
        createdAt: new Date().toISOString(),
      },
      snapshot: {
        sandboxId: "sb-first",
        providerId: "test",
        data: { tag: "exit-1" },
        createdAt: new Date().toISOString(),
      },
    });
    await handler(
      { subagent: "snap-agent", description: "test", prompt: "first" },
      { threadId: "t", toolCallId: "tc-1", toolName: "Subagent" }
    );

    // Call 2 — same thread, produces exit-2 (supersedes exit-1).
    nextStartChildResult = () => ({
      toolResponse: "second",
      data: null,
      threadId: "child-t",
      snapshot: {
        sandboxId: "sb-second",
        providerId: "test",
        data: { tag: "exit-2" },
        createdAt: new Date().toISOString(),
      },
    });
    await handler(
      {
        subagent: "snap-agent",
        description: "test",
        prompt: "second",
        threadId: "child-t",
      },
      { threadId: "t", toolCallId: "tc-2", toolName: "Subagent" }
    );

    await cleanupSubagentSnapshots();

    // Parent should have deleted both the latest thread snapshot and the
    // per-agent base snapshot through the subagent's sandbox.proxy.
    const deletedTags = opsMock.deleteSandboxSnapshot.mock.calls.map(
      (call) => (call[0] as { data: { tag: string } }).data.tag
    );
    expect(deletedTags.sort()).toEqual(["base", "exit-2"]);
  });

  it("publishes persistentBaseSnapshot from childSandboxReadySignal before child completes", async () => {
    const { setHandler, executeChild } = await import("@temporalio/workflow");
    const setHandlerMock = setHandler as ReturnType<typeof vi.fn>;
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    const signalBase = {
      sandboxId: "sb-signal",
      providerId: "test",
      data: { tag: "signal-base" },
      createdAt: new Date().toISOString(),
    };

    const config: SubagentConfig = {
      agentName: "snap-agent",
      description: "Snapshot-driven",
      workflow: mockWorkflow(),
      thread: "continue",
      sandbox: {
        source: "own",
        init: "once",
        continuation: "snapshot",
        proxy: noopSandboxProxy,
      },
    };

    const { handler } = createSubagentHandler([config]);

    // Fire the signal from inside executeChild so persistentBaseSnapshot is
    // set before the child's own result is returned. The child result itself
    // intentionally omits baseSnapshot — only the signal path can populate
    // the map for this call.
    execMock.mockImplementationOnce(
      async (_wf: unknown, opts: { workflowId: string; args: unknown[] }) => {
        const reg = setHandlerMock.mock.calls
          .filter(
            ([sig]) => (sig as { name?: string })?.name === "childSandboxReady"
          )
          .at(-1);
        const signalHandler = reg?.[1] as
          | ((p: {
              childWorkflowId: string;
              sandboxId: string;
              baseSnapshot?: unknown;
            }) => void)
          | undefined;
        signalHandler?.({
          childWorkflowId: opts.workflowId,
          sandboxId: "sb-signal",
          baseSnapshot: signalBase,
        });
        return {
          toolResponse: "first",
          data: null,
          threadId: "child-sig-1",
        };
      }
    );

    await handler(
      { subagent: "snap-agent", description: "test", prompt: "first" },
      { threadId: "t", toolCallId: "tc-1", toolName: "Subagent" }
    );

    // Second call on a new thread must boot from the signal-published base.
    nextStartChildResult = () => ({
      toolResponse: "second",
      data: null,
      threadId: "child-sig-2",
    });

    await handler(
      { subagent: "snap-agent", description: "test", prompt: "second" },
      { threadId: "t", toolCallId: "tc-2", toolName: "Subagent" }
    );

    const secondCall = execMock.mock.calls.at(-1);
    if (!secondCall) throw new Error("expected executeChild call");
    const secondInput = secondCall[1].args[1] as SubagentWorkflowInput;
    expect(secondInput.sandbox).toEqual({
      mode: "from-snapshot",
      snapshot: expect.objectContaining({ data: { tag: "signal-base" } }),
    });
  });

  it("ignores signal baseSnapshot for non-snapshot-base creators", async () => {
    const { setHandler, executeChild } = await import("@temporalio/workflow");
    const setHandlerMock = setHandler as ReturnType<typeof vi.fn>;
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    const config: SubagentConfig = {
      agentName: "lazy-fork-agent",
      description: "Lazy fork (not snapshot)",
      workflow: mockWorkflow(),
      sandbox: {
        source: "own",
        init: "once",
        continuation: "fork",
        proxy: noopSandboxProxy,
      },
    };

    const { handler } = createSubagentHandler([config]);

    execMock.mockImplementationOnce(
      async (_wf: unknown, opts: { workflowId: string; args: unknown[] }) => {
        const reg = setHandlerMock.mock.calls
          .filter(
            ([sig]) => (sig as { name?: string })?.name === "childSandboxReady"
          )
          .at(-1);
        const signalHandler = reg?.[1] as
          | ((p: {
              childWorkflowId: string;
              sandboxId: string;
              baseSnapshot?: unknown;
            }) => void)
          | undefined;
        // Stray baseSnapshot on a non-snapshot path must not land in
        // persistentBaseSnapshot, or it would corrupt a different agent's
        // snapshot flow.
        signalHandler?.({
          childWorkflowId: opts.workflowId,
          sandboxId: "sb-lazy",
          baseSnapshot: {
            sandboxId: "sb-lazy",
            providerId: "test",
            data: { tag: "should-be-ignored" },
            createdAt: new Date().toISOString(),
          },
        });
        return {
          toolResponse: "first",
          data: null,
          threadId: "child-lazy-1",
          sandboxId: "sb-lazy",
        };
      }
    );

    await handler(
      { subagent: "lazy-fork-agent", description: "test", prompt: "first" },
      { threadId: "t", toolCallId: "tc-1", toolName: "Subagent" }
    );

    // Second call should fork from the lazy-published sandbox, not restore
    // from any snapshot.
    nextStartChildResult = () => ({
      toolResponse: "second",
      data: null,
      threadId: "child-lazy-2",
      sandboxId: "sb-lazy",
    });

    await handler(
      { subagent: "lazy-fork-agent", description: "test", prompt: "second" },
      { threadId: "t", toolCallId: "tc-2", toolName: "Subagent" }
    );

    const secondCall = execMock.mock.calls.at(-1);
    if (!secondCall) throw new Error("expected executeChild call");
    const secondInput = secondCall[1].args[1] as SubagentWorkflowInput;
    expect(secondInput.sandbox).toEqual({
      mode: "fork",
      sandboxId: "sb-lazy",
    });
  });

  it("does not call deleteSandboxSnapshot for children that produced no snapshots", async () => {
    const opsMock = makeMockSandboxOps();
    const config: SubagentConfig = {
      agentName: "snap-agent",
      description: "Snapshot-driven",
      workflow: mockWorkflow(),
      thread: "continue",
      sandbox: {
        source: "own",
        init: "once",
        continuation: "snapshot",
        proxy: () => opsMock,
      },
    };

    const { handler, cleanupSubagentSnapshots } = createSubagentHandler([
      config,
    ]);

    nextStartChildResult = () => ({
      toolResponse: "no-snap",
      data: null,
      threadId: "child-t",
    });
    await handler(
      { subagent: "snap-agent", description: "test", prompt: "run" },
      { threadId: "t", toolCallId: "tc-1", toolName: "Subagent" }
    );

    await cleanupSubagentSnapshots();

    expect(opsMock.deleteSandboxSnapshot).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Child workflow failure propagation
  // -------------------------------------------------------------------------

  it("propagates executeChild failure to the caller instead of hanging", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;
    execMock.mockImplementationOnce(async () => {
      throw new Error("Child Workflow execution failed: timeout");
    });

    const { handler } = createSubagentHandler([
      {
        agentName: "researcher",
        description: "Researches topics",
        workflow: mockWorkflow("researcherWorkflow"),
      },
    ]);

    await expect(
      handler(
        { subagent: "researcher", description: "test", prompt: "hi" },
        { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
      )
    ).rejects.toThrow("Child Workflow execution failed: timeout");
  });

  it("applies a default workflowRunTimeout when workflowOptions is omitted", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    const { DEFAULT_SUBAGENT_WORKFLOW_RUN_TIMEOUT } = await import("./handler");

    const { handler } = createSubagentHandler([
      {
        agentName: "researcher",
        description: "Researches topics",
        workflow: mockWorkflow("researcherWorkflow"),
      },
    ]);

    await handler(
      { subagent: "researcher", description: "test", prompt: "hi" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    const lastCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected executeChild call");
    expect(lastCall[1].workflowRunTimeout).toBe(
      DEFAULT_SUBAGENT_WORKFLOW_RUN_TIMEOUT
    );
  });

  it("lets workflowOptions.workflowRunTimeout override the default", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    const { handler } = createSubagentHandler([
      {
        agentName: "researcher",
        description: "Researches topics",
        workflow: mockWorkflow("researcherWorkflow"),
        workflowOptions: { workflowRunTimeout: "30s" },
      },
    ]);

    await handler(
      { subagent: "researcher", description: "test", prompt: "hi" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    const lastCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected executeChild call");
    expect(lastCall[1].workflowRunTimeout).toBe("30s");
  });

  it("forwards workflowOptions to executeChild", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    const { handler } = createSubagentHandler([
      {
        agentName: "researcher",
        description: "Researches topics",
        workflow: mockWorkflow("researcherWorkflow"),
        workflowOptions: {
          workflowRunTimeout: "5m",
          workflowTaskTimeout: "30s",
          retry: { maximumAttempts: 1 },
        },
      },
    ]);

    await handler(
      { subagent: "researcher", description: "test", prompt: "hi" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    const lastCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected executeChild call");
    expect(lastCall[1]).toMatchObject({
      workflowRunTimeout: "5m",
      workflowTaskTimeout: "30s",
      retry: { maximumAttempts: 1 },
    });
  });

  it("does not let workflowOptions override workflowId, taskQueue, or args", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    const { handler } = createSubagentHandler([
      {
        agentName: "researcher",
        description: "Researches topics",
        workflow: mockWorkflow("researcherWorkflow"),
        taskQueue: "my-queue",
        workflowOptions: {
          // Intentionally violates the public Omit<> type to prove the
          // handler still wins at runtime. Cast removes the type error.
          ...({
            workflowId: "forbidden-id",
            taskQueue: "forbidden-queue",
            args: ["forbidden"],
          } as Record<string, unknown>),
        },
      },
    ]);

    await handler(
      { subagent: "researcher", description: "test", prompt: "hello" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    const lastCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected executeChild call");
    expect(lastCall[1].workflowId).not.toBe("forbidden-id");
    expect(lastCall[1].workflowId).toMatch(/^researcher-/);
    expect(lastCall[1].taskQueue).toBe("my-queue");
    expect(lastCall[1].args[0]).toBe("hello");
  });

  it("clears lazy-creator bookkeeping on failure so the next call can re-try", async () => {
    const opsMock = makeMockSandboxOps();
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;

    const lazySubagent: SubagentConfig = {
      agentName: "lazy",
      description: "Lazy sandbox init",
      workflow: mockWorkflow(),
      sandbox: {
        source: "own",
        init: "once",
        continuation: "fork",
        proxy: () => opsMock,
      },
    };

    const { handler } = createSubagentHandler([lazySubagent]);

    execMock.mockImplementationOnce(async () => {
      throw new Error("init failed");
    });

    await expect(
      handler(
        { subagent: "lazy", description: "test", prompt: "first" },
        { threadId: "t", toolCallId: "tc-1", toolName: "Subagent" }
      )
    ).rejects.toThrow("init failed");

    // A second call must be able to take the creator role again (no stranded
    // "creating" flag) and succeed.
    nextStartChildResult = () => ({
      toolResponse: "ok",
      data: null,
      threadId: "child-t-2",
      sandboxId: "child-sb-2",
    });

    const result = await handler(
      { subagent: "lazy", description: "test", prompt: "second" },
      { threadId: "t", toolCallId: "tc-2", toolName: "Subagent" }
    );

    expect(result.toolResponse).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// buildSubagentRegistration
// ---------------------------------------------------------------------------

describe("buildSubagentRegistration", () => {
  it("returns null for empty array", () => {
    expect(buildSubagentRegistration([])).toBeNull();
  });

  it("creates registration with correct tool name", () => {
    const reg = buildSubagentRegistration([
      {
        agentName: "agent",
        description: "An agent",
        workflow: mockWorkflow(),
      },
    ]);

    expect(reg).not.toBeNull();
    if (reg) {
      expect(reg.registration.name).toBe(SUBAGENT_TOOL_NAME);
      expect(typeof reg.registration.handler).toBe("function");
    }
  });

  it("enabled function is re-evaluated dynamically", () => {
    let flag = true;
    const reg = buildSubagentRegistration([
      {
        agentName: "toggle",
        description: "Toggleable",
        workflow: mockWorkflow(),
        enabled: () => flag,
      },
    ]);

    expect(reg).toBeDefined();
    if (!reg) return;
    expect((reg.registration.enabled as () => boolean)()).toBe(true);

    flag = false;
    expect((reg.registration.enabled as () => boolean)()).toBe(false);
  });

  it("disabled when all subagents are disabled", () => {
    const reg = buildSubagentRegistration([
      {
        agentName: "off",
        description: "Disabled",
        workflow: mockWorkflow(),
        enabled: false,
      },
    ]);

    expect(reg).toBeDefined();
    if (reg) {
      expect((reg.registration.enabled as () => boolean)()).toBe(false);
    }
  });

  it("includes hooks when subagents have hooks configured", () => {
    const hookSpy = vi.fn(async () => ({}));

    const reg = buildSubagentRegistration([
      {
        agentName: "hooked",
        description: "Has hooks",
        workflow: mockWorkflow(),
        hooks: {
          onPreExecution: hookSpy,
        },
      },
    ]);

    expect(reg).toBeDefined();
    if (reg) {
      expect(reg.registration.hooks).toBeDefined();
      if (reg.registration.hooks) {
        expect(reg.registration.hooks.onPreToolUse).toBeDefined();
      }
    }
  });

  it("does not include hooks when no subagents have hooks", () => {
    const reg = buildSubagentRegistration([
      {
        agentName: "plain",
        description: "No hooks",
        workflow: mockWorkflow(),
      },
    ]);

    expect(reg).toBeDefined();
    if (reg) {
      expect(reg.registration.hooks).toBeUndefined();
    }
  });

  it("dynamic schema/description updates when enabled function changes", () => {
    let bEnabled = true;
    const reg = buildSubagentRegistration([
      {
        agentName: "a",
        description: "Agent A",
        workflow: mockWorkflow(),
        enabled: true,
      },
      {
        agentName: "b",
        description: "Agent B",
        workflow: mockWorkflow(),
        enabled: () => bEnabled,
      },
    ]);

    expect(reg).toBeDefined();
    if (reg) {
      const desc = reg.registration.description as () => string;
      expect(desc()).toContain("Agent A");
      expect(desc()).toContain("Agent B");

      bEnabled = false;

      expect(desc()).toContain("Agent A");
      expect(desc()).not.toContain("Agent B");
    }
  });
});

// ---------------------------------------------------------------------------
// defineSubagent
// ---------------------------------------------------------------------------

describe("defineSubagent", () => {
  const makeDef = (name: string) =>
    defineSubagentWorkflow(
      { name, description: `${name} agent` },
      async () => ({ toolResponse: "ok", data: null, threadId: "t" })
    );

  it("enabled function is re-evaluated dynamically", () => {
    let flag = true;
    const config = defineSubagent(makeDef("dynamic"), {
      enabled: () => flag,
    });

    const resolve = config.enabled as () => boolean;
    expect(resolve()).toBe(true);
    flag = false;
    expect(resolve()).toBe(false);
  });

  it("enabled function works through buildSubagentRegistration", () => {
    let flag = true;
    const config = defineSubagent(makeDef("dynamic"), {
      enabled: () => flag,
    });

    const reg = buildSubagentRegistration([config]);
    expect(reg).toBeDefined();
    if (!reg) return;
    expect((reg.registration.enabled as () => boolean)()).toBe(true);

    flag = false;
    expect((reg.registration.enabled as () => boolean)()).toBe(false);
  });

  it("passes sandbox none through to config", () => {
    const config = defineSubagent(makeDef("no-sb"), {
      sandbox: "none",
    });

    expect(config.sandbox).toBe("none");
  });

  it("defaults sandbox to undefined (none behavior)", () => {
    const config = defineSubagent(makeDef("default-sb"));

    expect(config.sandbox).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// defineSubagentWorkflow
// ---------------------------------------------------------------------------

describe("defineSubagentWorkflow", () => {
  it("maps thread fork into sessionInput", async () => {
    let capturedSession: SubagentSessionInput | undefined;

    const workflow = defineSubagentWorkflow(
      { name: "test", description: "test agent" },
      async (_prompt, sessionInput) => {
        capturedSession = sessionInput;
        return { toolResponse: "ok", data: null, threadId: "t" };
      }
    );

    await workflow("go", { thread: { mode: "fork", threadId: "prev-42" } });

    expect(capturedSession).toEqual({
      agentName: "test",
      sandboxShutdown: "destroy",
      thread: { mode: "fork", threadId: "prev-42" },
      onSandboxReady: expect.any(Function),
      onSessionExit: expect.any(Function),
    });
  });

  it("maps sandbox inherit", async () => {
    let capturedSession: SubagentSessionInput | undefined;
    const workflow = defineSubagentWorkflow(
      { name: "test", description: "test agent" },
      async (_prompt, sessionInput) => {
        capturedSession = sessionInput;
        return { toolResponse: "ok", data: null, threadId: "t" };
      }
    );

    await workflow("go", { sandbox: { mode: "inherit", sandboxId: "sb-123" } });
    expect(capturedSession).toEqual({
      agentName: "test",
      sandboxShutdown: "destroy",
      sandbox: { mode: "inherit", sandboxId: "sb-123" },
      onSandboxReady: expect.any(Function),
      onSessionExit: expect.any(Function),
    });
  });

  it("maps sandbox fork", async () => {
    let capturedSession: SubagentSessionInput | undefined;
    const workflow = defineSubagentWorkflow(
      { name: "test", description: "test agent" },
      async (_prompt, sessionInput) => {
        capturedSession = sessionInput;
        return { toolResponse: "ok", data: null, threadId: "t" };
      }
    );

    await workflow("go", { sandbox: { mode: "fork", sandboxId: "prev-sb-1" } });
    expect(capturedSession).toEqual({
      agentName: "test",
      sandboxShutdown: "destroy",
      sandbox: { mode: "fork", sandboxId: "prev-sb-1" },
      onSandboxReady: expect.any(Function),
      onSessionExit: expect.any(Function),
    });
  });

  it("maps thread fork and sandbox fork together", async () => {
    let capturedSession: SubagentSessionInput | undefined;
    const workflow = defineSubagentWorkflow(
      { name: "test", description: "test agent" },
      async (_prompt, sessionInput) => {
        capturedSession = sessionInput;
        return { toolResponse: "ok", data: null, threadId: "t" };
      }
    );

    await workflow("go", {
      thread: { mode: "fork", threadId: "prev-t" },
      sandbox: { mode: "fork", sandboxId: "prev-sb" },
    });
    expect(capturedSession).toEqual({
      agentName: "test",
      sandboxShutdown: "destroy",
      thread: { mode: "fork", threadId: "prev-t" },
      sandbox: { mode: "fork", sandboxId: "prev-sb" },
      onSandboxReady: expect.any(Function),
      onSessionExit: expect.any(Function),
    });
  });

  it("passes context as optional third argument", async () => {
    let capturedContext: Record<string, unknown> | undefined;
    const workflow = defineSubagentWorkflow(
      { name: "test", description: "test agent" },
      async (_prompt, _sessionInput, context) => {
        capturedContext = context;
        return { toolResponse: "ok", data: null, threadId: "t" };
      }
    );

    await workflow("go", {}, { key: "val" });

    expect(capturedContext).toEqual({ key: "val" });
  });

  it("returns the handler response unchanged", async () => {
    const workflow = defineSubagentWorkflow(
      {
        name: "test",
        description: "test agent",
        resultSchema: z.object({ count: z.number() }),
      },
      async () => ({
        toolResponse: "result text",
        data: { count: 42 },
        threadId: "child-thread",
      })
    );

    const result = await workflow("go", {});

    expect(result.toolResponse).toBe("result text");
    expect(result.data).toEqual({ count: 42 });
    expect(result.threadId).toBe("child-thread");
  });

  it("attaches metadata to the returned workflow function", () => {
    const schema = z.object({ findings: z.string() });
    const workflow = defineSubagentWorkflow(
      {
        name: "researcher",
        description: "Researches topics",
        resultSchema: schema,
      },
      async () => ({ toolResponse: "ok", data: null, threadId: "t" })
    );

    expect(workflow.agentName).toBe("researcher");
    expect(workflow.description).toBe("Researches topics");
    expect(workflow.resultSchema).toBe(schema);
  });

  it("passes empty workflowInput fields as empty sessionInput", async () => {
    let capturedSession: SubagentSessionInput | undefined;
    const workflow = defineSubagentWorkflow(
      { name: "test", description: "test agent" },
      async (_prompt, sessionInput) => {
        capturedSession = sessionInput;
        return { toolResponse: "ok", data: null, threadId: "t" };
      }
    );

    await workflow("go", {});
    expect(capturedSession).toEqual({
      agentName: "test",
      sandboxShutdown: "destroy",
      onSandboxReady: expect.any(Function),
      onSessionExit: expect.any(Function),
    });
  });

  it("uses keep-until-parent-close from workflowInput override in sessionInput", async () => {
    let capturedSession: SubagentSessionInput | undefined;
    const workflow = defineSubagentWorkflow(
      { name: "test", description: "test agent" },
      async (_prompt, sessionInput) => {
        capturedSession = sessionInput;
        return {
          toolResponse: "ok",
          data: null,
          threadId: "t",
          sandboxId: "sb-1",
        };
      }
    );

    await workflow("go", { sandboxShutdown: "keep-until-parent-close" });

    expect(capturedSession?.sandboxShutdown).toBe("keep-until-parent-close");
  });

  // -------------------------------------------------------------------------
  // Auto-forwarding of session outputs + signal payload
  // -------------------------------------------------------------------------

  it("auto-forwards baseSnapshot captured via onSandboxReady", async () => {
    const baseSnapshot = {
      sandboxId: "sb-1",
      providerId: "test",
      data: { tag: "base" },
      createdAt: new Date().toISOString(),
    };
    const workflow = defineSubagentWorkflow(
      { name: "test", description: "test agent" },
      async (_prompt, sessionInput) => {
        sessionInput.onSandboxReady?.({ sandboxId: "sb-1", baseSnapshot });
        return { toolResponse: "ok", data: null, threadId: "t" };
      }
    );

    const result = await workflow("go", {});
    expect(result.baseSnapshot).toEqual(baseSnapshot);
  });

  it("auto-forwards sandboxId and snapshot captured via onSessionExit", async () => {
    const snapshot = {
      sandboxId: "sb-1",
      providerId: "test",
      data: { tag: "exit" },
      createdAt: new Date().toISOString(),
    };
    const workflow = defineSubagentWorkflow(
      { name: "test", description: "test agent" },
      async (_prompt, sessionInput) => {
        sessionInput.onSessionExit?.({
          sandboxId: "sb-1",
          snapshot,
          threadId: "t",
          usage: { totalInputTokens: 0, totalOutputTokens: 0, totalCachedWriteTokens: 0, totalCachedReadTokens: 0, totalReasonTokens: 0, turns: 0 },
        });
        return { toolResponse: "ok", data: null, threadId: "t" };
      }
    );

    const result = await workflow("go", {});
    expect(result.sandboxId).toBe("sb-1");
    expect(result.snapshot).toEqual(snapshot);
  });

  it("fn-explicit sandbox outputs win over captured session outputs", async () => {
    const workflow = defineSubagentWorkflow(
      { name: "test", description: "test agent" },
      async (_prompt, sessionInput) => {
        sessionInput.onSessionExit?.({
          sandboxId: "session-sb",
          snapshot: {
            sandboxId: "session-sb",
            providerId: "test",
            data: { tag: "session" },
            createdAt: new Date().toISOString(),
          },
          threadId: "t",
          usage: { totalInputTokens: 0, totalOutputTokens: 0, totalCachedWriteTokens: 0, totalCachedReadTokens: 0, totalReasonTokens: 0, turns: 0 },
        });
        return {
          toolResponse: "ok",
          data: null,
          threadId: "t",
          sandboxId: "explicit-sb",
          snapshot: {
            sandboxId: "explicit-sb",
            providerId: "test",
            data: { tag: "explicit" },
            createdAt: new Date().toISOString(),
          },
        };
      }
    );

    const result = await workflow("go", {});
    expect(result.sandboxId).toBe("explicit-sb");
    expect(
      (result.snapshot as { data: { tag: string } } | undefined)?.data
    ).toEqual({ tag: "explicit" });
  });

  it("signals parent with baseSnapshot via childSandboxReadySignal", async () => {
    const { getExternalWorkflowHandle } = await import("@temporalio/workflow");
    const ghMock = getExternalWorkflowHandle as ReturnType<typeof vi.fn>;
    const baseSnapshot = {
      sandboxId: "sb-1",
      providerId: "test",
      data: { tag: "base" },
      createdAt: new Date().toISOString(),
    };

    const workflow = defineSubagentWorkflow(
      { name: "test", description: "test agent" },
      async (_prompt, sessionInput) => {
        sessionInput.onSandboxReady?.({ sandboxId: "sb-1", baseSnapshot });
        return { toolResponse: "ok", data: null, threadId: "t" };
      }
    );

    await workflow("go", {});

    const handle = ghMock.mock.results.at(-1)?.value as {
      signal: ReturnType<typeof vi.fn>;
    };
    expect(handle.signal).toHaveBeenCalledWith(
      expect.objectContaining({ name: "childSandboxReady" }),
      expect.objectContaining({
        childWorkflowId: "child-wf-1",
        sandboxId: "sb-1",
        baseSnapshot,
      })
    );
  });

  it("omits baseSnapshot from signal when session did not capture one", async () => {
    const { getExternalWorkflowHandle } = await import("@temporalio/workflow");
    const ghMock = getExternalWorkflowHandle as ReturnType<typeof vi.fn>;

    const workflow = defineSubagentWorkflow(
      { name: "test", description: "test agent" },
      async (_prompt, sessionInput) => {
        sessionInput.onSandboxReady?.({ sandboxId: "sb-1" });
        return { toolResponse: "ok", data: null, threadId: "t" };
      }
    );

    await workflow("go", {});

    const handle = ghMock.mock.results.at(-1)?.value as {
      signal: ReturnType<typeof vi.fn>;
    };
    const payload = handle.signal.mock.calls.at(-1)?.[1] as {
      childWorkflowId: string;
      sandboxId: string;
      baseSnapshot?: unknown;
    };
    expect(payload).toEqual({
      childWorkflowId: "child-wf-1",
      sandboxId: "sb-1",
    });
    expect(payload.baseSnapshot).toBeUndefined();
  });

  it("skips the signal when the sandbox is reused (continue mode)", async () => {
    const { getExternalWorkflowHandle } = await import("@temporalio/workflow");
    const ghMock = getExternalWorkflowHandle as ReturnType<typeof vi.fn>;

    const workflow = defineSubagentWorkflow(
      { name: "test", description: "test agent" },
      async (_prompt, sessionInput) => {
        sessionInput.onSandboxReady?.({ sandboxId: "sb-1" });
        return { toolResponse: "ok", data: null, threadId: "t" };
      }
    );

    await workflow("go", {
      sandbox: { mode: "continue", sandboxId: "sb-1" },
    });

    const handle = ghMock.mock.results.at(-1)?.value as {
      signal: ReturnType<typeof vi.fn>;
    };
    expect(handle.signal).not.toHaveBeenCalled();
  });
});
