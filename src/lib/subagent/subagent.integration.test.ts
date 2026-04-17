import { describe, expect, it, vi, afterEach } from "vitest";
import { z } from "zod";

const capturedSignalHandlers = new Map<unknown, (...args: unknown[]) => void>();

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
    setHandler: vi.fn(
      (signal: unknown, handler: (...a: unknown[]) => void) => {
        capturedSignalHandlers.set(signal, handler);
      }
    ),
    condition: vi.fn(async (fn: () => boolean) => {
      if (!fn()) throw new Error("condition predicate was not satisfied");
    }),
    startChild: vi.fn(
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

        for (const [signal, handler] of capturedSignalHandlers.entries()) {
          if ((signal as { name?: string }).name === "childResult") {
            handler({ childWorkflowId: opts.workflowId, result });
          }
        }

        return {
          signal: vi.fn(),
          result: () => Promise.resolve(result),
          workflowId: opts.workflowId,
        };
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
  capturedSignalHandlers.clear();
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
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

    const inheritSubagent: SubagentConfig = {
      agentName: "inherit-agent",
      description: "Inherits sandbox",
      workflow: mockWorkflow(),
      sandbox: { source: "inherit", continuation: "continue" },
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

    const lastCall = startMock.mock.calls[startMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected startChild call");
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
      sandbox: { source: "inherit", continuation: "continue" },
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
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

    const ownSubagent: SubagentConfig = {
      agentName: "own-agent",
      description: "Own sandbox",
      workflow: mockWorkflow(),
      sandbox: { source: "own", continuation: "fork" },
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

    const lastCall = startMock.mock.calls[startMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected startChild call");
    const workflowInput = lastCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.sandbox).toBeUndefined();
  });

  it("resolves context function at invocation time", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

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

    const lastCall = startMock.mock.calls[startMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected startChild call");
    const context = lastCall[1].args[2] as Record<string, unknown>;
    expect(context).toEqual({ invocation: 1 });
  });

  it("passes static context unchanged", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

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

    const lastCall = startMock.mock.calls[startMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected startChild call");
    const context = lastCall[1].args[2] as Record<string, unknown>;
    expect(context).toEqual({ key: "value" });
  });

  it("does not pass sandbox init when sandbox is own without prior sandbox", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

    const ownSubagent: SubagentConfig = {
      agentName: "own-agent",
      description: "Own sandbox",
      workflow: mockWorkflow(),
      sandbox: { source: "own", continuation: "fork" },
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

    const lastCall = startMock.mock.calls[startMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected startChild call");
    const workflowInput = lastCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.sandbox).toBeUndefined();
  });

  // --- Thread mode ---

  it("passes thread fork when thread is fork and threadId provided", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

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

    const lastCall = startMock.mock.calls[startMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected startChild call");
    const workflowInput = lastCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.thread).toEqual({
      mode: "fork",
      threadId: "prev-thread-42",
    });
  });

  it("passes thread continue when thread is continue", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

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

    const lastCall = startMock.mock.calls[startMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected startChild call");
    const workflowInput = lastCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.thread).toEqual({
      mode: "continue",
      threadId: "prev-thread-99",
    });
  });

  it("does not pass thread when thread is new", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

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

    const lastCall = startMock.mock.calls[startMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected startChild call");
    const workflowInput = lastCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.thread).toBeUndefined();
  });

  // --- Sandbox continuation ---

  it("does not pass sandbox when thread is fork (own sandbox)", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

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

    const lastCall = startMock.mock.calls[startMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected startChild call");
    const workflowInput = lastCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.sandbox).toBeUndefined();
  });

  it("tracks sandbox ID and passes sandbox fork on continuation", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

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
      sandbox: { source: "own", continuation: "fork" },
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

    const secondCall = startMock.mock.calls[startMock.mock.calls.length - 1];
    if (!secondCall) throw new Error("expected second startChild call");
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
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

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
      sandbox: { source: "own", continuation: "fork" },
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

    const secondCall = startMock.mock.calls[startMock.mock.calls.length - 1];
    if (!secondCall) throw new Error("expected startChild call");
    const workflowInput = secondCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.sandbox).toBeUndefined();
    expect(workflowInput.thread).toBeUndefined();
  });

  it("does not signal destroy for fork-mode subagent without pause-until-parent-close", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

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

    const lastResult = startMock.mock.results.at(-1);
    if (!lastResult) throw new Error("expected startChild call");
    const childHandle = await lastResult.value;
    childHandle.signal.mockClear();

    await destroySubagentSandboxes();

    expect(childHandle.signal).not.toHaveBeenCalled();
  });

  it("does not signal destroy for sandbox=own with default shutdown", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

    const ownSubagent: SubagentConfig = {
      agentName: "own-agent",
      description: "Own sandbox",
      workflow: mockWorkflow(),
      sandbox: { source: "own", continuation: "fork" },
    };

    const { handler, destroySubagentSandboxes } = createSubagentHandler([
      ownSubagent,
    ]);

    await handler(
      { subagent: "own-agent", description: "test", prompt: "run" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    const lastResult = startMock.mock.results.at(-1);
    if (!lastResult) throw new Error("expected startChild call");
    const childHandle = await lastResult.value;
    childHandle.signal.mockClear();

    await destroySubagentSandboxes();

    expect(childHandle.signal).not.toHaveBeenCalled();
  });

  it("signals destroy for sandbox=own with pause-until-parent-close shutdown", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

    const ownSubagent: SubagentConfig = {
      agentName: "own-agent",
      description: "Own sandbox",
      workflow: mockWorkflow(),
      sandbox: {
        source: "own",
        continuation: "fork",
        shutdown: "pause-until-parent-close",
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

    const lastResult = startMock.mock.results.at(-1);
    if (!lastResult) throw new Error("expected startChild call");
    const childHandle = await lastResult.value;
    expect(childHandle.signal).toHaveBeenCalled();
  });

  it("does not signal destroy for inherit subagents", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

    const inheritSubagent: SubagentConfig = {
      agentName: "inherit-agent",
      description: "Inherits sandbox",
      workflow: mockWorkflow(),
      sandbox: { source: "inherit", continuation: "continue" },
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

    const lastResult = startMock.mock.results.at(-1);
    if (!lastResult) throw new Error("expected startChild call");
    const childHandle = await lastResult.value;
    childHandle.signal.mockClear();

    await destroySubagentSandboxes();

    expect(childHandle.signal).not.toHaveBeenCalled();
  });

  it("does not pass sandboxId when sandbox is none (default)", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

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

    const lastCall = startMock.mock.calls[startMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected startChild call");
    const workflowInput = lastCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.sandbox).toBeUndefined();
  });

  it("does not pass sandboxId when sandbox is explicitly none", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

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

    const lastCall = startMock.mock.calls[startMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected startChild call");
    const workflowInput = lastCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.sandbox).toBeUndefined();
  });

  it("does not signal destroy for none subagents", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

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

    const lastResult = startMock.mock.results.at(-1);
    if (!lastResult) throw new Error("expected startChild call");
    const childHandle = await lastResult.value;
    childHandle.signal.mockClear();

    await destroySubagentSandboxes();

    expect(childHandle.signal).not.toHaveBeenCalled();
  });

  // --- inherit + continuation: fork ---

  it("forks from parent sandbox when inherit + continuation=fork", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

    const config: SubagentConfig = {
      agentName: "inherit-fork",
      description: "Inherit fork",
      workflow: mockWorkflow(),
      sandbox: { source: "inherit", continuation: "fork" },
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

    const lastCall = startMock.mock.calls.at(-1);
    if (!lastCall) throw new Error("expected startChild call");
    const workflowInput = lastCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.sandbox).toEqual({
      mode: "fork",
      sandboxId: "parent-sb",
    });
  });

  // --- own + continuation: continue ---

  it("passes sandbox continue on thread continuation with continuation=continue", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

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
      sandbox: { source: "own", continuation: "continue" },
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

    const secondCall = startMock.mock.calls.at(-1);
    if (!secondCall) throw new Error("expected startChild call");
    const workflowInput = secondCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.sandbox).toEqual({
      mode: "continue",
      sandboxId: "child-sb-1",
    });
    expect(workflowInput.sandboxShutdown).toBe("pause");
  });

  // --- own + init: once + continuation: fork ---

  it("stores sandbox on first call and forks from it on second call (init=once, continuation=fork)", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

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
      sandbox: { source: "own", init: "once", continuation: "fork" },
    };

    const { handler } = createSubagentHandler([config]);

    await handler(
      { subagent: "lazy-fork", description: "test", prompt: "first" },
      { threadId: "t", toolCallId: "tc-1", toolName: "Subagent" }
    );

    // First call: no sandbox init (child creates fresh), forced pause-until-parent-close
    const firstCall = startMock.mock.calls.at(-1);
    if (!firstCall) throw new Error("expected startChild call");
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

    const secondCall = startMock.mock.calls.at(-1);
    if (!secondCall) throw new Error("expected startChild call");
    const secondInput = secondCall[1].args[1] as SubagentWorkflowInput;
    expect(secondInput.sandbox).toEqual({
      mode: "fork",
      sandboxId: "persistent-sb",
    });
  });

  // --- own + init: once + continuation: continue ---

  it("stores sandbox on first call and continues it on second call (init=once, continuation=continue)", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

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
      sandbox: { source: "own", init: "once", continuation: "continue" },
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

    const secondCall = startMock.mock.calls.at(-1);
    if (!secondCall) throw new Error("expected startChild call");
    const secondInput = secondCall[1].args[1] as SubagentWorkflowInput;
    expect(secondInput.sandbox).toEqual({
      mode: "continue",
      sandboxId: "persistent-sb",
    });
    expect(secondInput.sandboxShutdown).toBe("pause");
  });

  // --- init: once cleanup ---

  it("adds first-call child handle to pendingDestroys for init=once", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

    nextStartChildResult = () => ({
      toolResponse: "done",
      data: null,
      threadId: "child-t-1",
      sandboxId: "persistent-sb",
    });

    const config: SubagentConfig = {
      agentName: "lazy-cleanup",
      description: "Lazy cleanup",
      workflow: mockWorkflow(),
      sandbox: { source: "own", init: "once", continuation: "fork" },
    };

    const { handler, destroySubagentSandboxes } = createSubagentHandler([
      config,
    ]);

    await handler(
      { subagent: "lazy-cleanup", description: "test", prompt: "run" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    await destroySubagentSandboxes();

    const lastResult = startMock.mock.results.at(-1);
    if (!lastResult) throw new Error("expected startChild call");
    const childHandle = await lastResult.value;
    expect(childHandle.signal).toHaveBeenCalled();
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
      sandbox: { source: "own", continuation: "fork" },
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

  it("signals destroy for sandbox=own with keep-until-parent-close shutdown", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

    const ownSubagent: SubagentConfig = {
      agentName: "own-keep",
      description: "Own sandbox kept",
      workflow: mockWorkflow(),
      sandbox: {
        source: "own",
        continuation: "fork",
        shutdown: "keep-until-parent-close",
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

    const lastResult = startMock.mock.results.at(-1);
    if (!lastResult) throw new Error("expected startChild call");
    const childHandle = await lastResult.value;
    expect(childHandle.signal).toHaveBeenCalled();
  });

  it("does not signal destroy for sandbox=own with keep shutdown (without parent-close)", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

    const ownSubagent: SubagentConfig = {
      agentName: "own-keep-plain",
      description: "Own sandbox keep",
      workflow: mockWorkflow(),
      sandbox: { source: "own", continuation: "fork", shutdown: "keep" },
    };

    const { handler, destroySubagentSandboxes } = createSubagentHandler([
      ownSubagent,
    ]);

    await handler(
      { subagent: "own-keep-plain", description: "test", prompt: "run" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    const lastResult = startMock.mock.results.at(-1);
    if (!lastResult) throw new Error("expected startChild call");
    const childHandle = await lastResult.value;
    childHandle.signal.mockClear();

    await destroySubagentSandboxes();

    expect(childHandle.signal).not.toHaveBeenCalled();
  });

  // --- mustSurvive does not override user shutdown ---

  it("does not override keep-until-parent-close with pause-until-parent-close for init=once", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

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
      },
    };

    const { handler } = createSubagentHandler([config]);

    await handler(
      { subagent: "lazy-keep", description: "test", prompt: "first" },
      { threadId: "t", toolCallId: "tc-1", toolName: "Subagent" }
    );

    const firstCall = startMock.mock.calls.at(-1);
    if (!firstCall) throw new Error("expected startChild call");
    const firstInput = firstCall[1].args[1] as SubagentWorkflowInput;
    expect(firstInput.sandboxShutdown).toBe("keep-until-parent-close");
  });

  it("does not override pause with pause-until-parent-close for init=once", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

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
      },
    };

    const { handler } = createSubagentHandler([config]);

    await handler(
      { subagent: "lazy-pause", description: "test", prompt: "first" },
      { threadId: "t", toolCallId: "tc-1", toolName: "Subagent" }
    );

    const firstCall = startMock.mock.calls.at(-1);
    if (!firstCall) throw new Error("expected startChild call");
    const firstInput = firstCall[1].args[1] as SubagentWorkflowInput;
    expect(firstInput.sandboxShutdown).toBe("pause");
  });

  it("does not override keep with pause for continuation=continue", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

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
      sandbox: { source: "own", continuation: "continue", shutdown: "keep" },
    };

    const { handler } = createSubagentHandler([config]);

    await handler(
      { subagent: "cont-keep", description: "test", prompt: "first" },
      { threadId: "t", toolCallId: "tc-1", toolName: "Subagent" }
    );

    const firstCall = startMock.mock.calls.at(-1);
    if (!firstCall) throw new Error("expected startChild call");
    const firstInput = firstCall[1].args[1] as SubagentWorkflowInput;
    expect(firstInput.sandboxShutdown).toBe("keep");
  });

  it("still overrides destroy with pause for continuation=continue", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

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
      sandbox: { source: "own", continuation: "continue", shutdown: "destroy" },
    };

    const { handler } = createSubagentHandler([config]);

    await handler(
      { subagent: "cont-destroy", description: "test", prompt: "first" },
      { threadId: "t", toolCallId: "tc-1", toolName: "Subagent" }
    );

    const firstCall = startMock.mock.calls.at(-1);
    if (!firstCall) throw new Error("expected startChild call");
    const firstInput = firstCall[1].args[1] as SubagentWorkflowInput;
    expect(firstInput.sandboxShutdown).toBe("pause");
  });

  // --- snapshot continuation ---

  it("forces sandboxShutdown=snapshot and passes no sandbox on first call (continuation=snapshot)", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

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
      sandbox: { source: "own", init: "once", continuation: "snapshot" },
    };

    const { handler } = createSubagentHandler([config]);

    await handler(
      { subagent: "snap-agent", description: "test", prompt: "first" },
      { threadId: "t", toolCallId: "tc-1", toolName: "Subagent" }
    );

    const firstCall = startMock.mock.calls.at(-1);
    if (!firstCall) throw new Error("expected startChild call");
    const firstInput = firstCall[1].args[1] as SubagentWorkflowInput;
    expect(firstInput.sandbox).toBeUndefined();
    expect(firstInput.sandboxShutdown).toBe("snapshot");
  });

  it("boots follow-up from stored thread snapshot on continuation=snapshot", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

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
      sandbox: { source: "own", init: "once", continuation: "snapshot" },
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

    const secondCall = startMock.mock.calls.at(-1);
    if (!secondCall) throw new Error("expected startChild call");
    const secondInput = secondCall[1].args[1] as SubagentWorkflowInput;
    expect(secondInput.sandbox).toEqual({
      mode: "from-snapshot",
      snapshot: expect.objectContaining({ data: { tag: "exit-1" } }),
    });
    expect(secondInput.sandboxShutdown).toBe("snapshot");
  });

  it("uses per-agent base snapshot for a new thread when init=once + continuation=snapshot", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

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
      sandbox: { source: "own", init: "once", continuation: "snapshot" },
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

    const secondCall = startMock.mock.calls.at(-1);
    if (!secondCall) throw new Error("expected startChild call");
    const secondInput = secondCall[1].args[1] as SubagentWorkflowInput;
    expect(secondInput.sandbox).toEqual({
      mode: "from-snapshot",
      snapshot: expect.objectContaining({ data: { tag: "base" } }),
    });
  });

  it("signals cleanupSnapshots to every snapshot-producing child during sweep", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

    const config: SubagentConfig = {
      agentName: "snap-agent",
      description: "Snapshot-driven",
      workflow: mockWorkflow(),
      thread: "continue",
      sandbox: { source: "own", init: "once", continuation: "snapshot" },
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
    const firstResult = startMock.mock.results.at(-1);
    if (!firstResult) throw new Error("expected startChild call");
    const firstHandle = await firstResult.value;

    // Call 2 — same thread, produces exit-2.
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
    const secondResult = startMock.mock.results.at(-1);
    if (!secondResult) throw new Error("expected startChild call");
    const secondHandle = await secondResult.value;

    // Cleanup sweep: both children should receive cleanupSnapshots signal.
    firstHandle.signal.mockClear();
    secondHandle.signal.mockClear();
    await cleanupSubagentSnapshots();

    expect(firstHandle.signal).toHaveBeenCalledTimes(1);
    expect(firstHandle.signal.mock.calls[0][0]).toEqual(
      expect.objectContaining({ name: "cleanupSnapshots" })
    );
    expect(secondHandle.signal).toHaveBeenCalledTimes(1);
    expect(secondHandle.signal.mock.calls[0][0]).toEqual(
      expect.objectContaining({ name: "cleanupSnapshots" })
    );
  });

  it("does not signal cleanupSnapshots for children that produced no snapshots", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

    const config: SubagentConfig = {
      agentName: "snap-agent",
      description: "Snapshot-driven",
      workflow: mockWorkflow(),
      thread: "continue",
      sandbox: { source: "own", init: "once", continuation: "snapshot" },
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
    const lastResult = startMock.mock.results.at(-1);
    if (!lastResult) throw new Error("expected startChild call");
    const childHandle = await lastResult.value;

    childHandle.signal.mockClear();
    await cleanupSubagentSnapshots();
    expect(childHandle.signal).not.toHaveBeenCalled();
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
    });
  });

  it("validates destroySandbox required for keep-until-parent-close", async () => {
    // @ts-expect-error — deliberately omitting destroySandbox to test runtime validation
    const workflow = defineSubagentWorkflow(
      {
        name: "test",
        description: "test agent",
        sandboxShutdown: "keep-until-parent-close",
      },
      async () => ({
        toolResponse: "ok",
        data: null,
        threadId: "t",
        sandboxId: "sb-1",
      })
    );

    await expect(workflow("go", {})).rejects.toThrow(
      /keep-until-parent-close.*destroySandbox/
    );
  });

  it("validates sandboxId required for keep-until-parent-close", async () => {
    // @ts-expect-error — deliberately omitting sandboxId to test runtime validation
    const workflow = defineSubagentWorkflow(
      {
        name: "test",
        description: "test agent",
        sandboxShutdown: "keep-until-parent-close",
      },
      async () => ({
        toolResponse: "ok",
        data: null,
        threadId: "t",
        destroySandbox: async () => {},
      })
    );

    await expect(workflow("go", {})).rejects.toThrow(
      /keep-until-parent-close.*sandboxId/
    );
  });

  it("uses keep-until-parent-close from workflowInput override in sessionInput", async () => {
    let capturedSession: SubagentSessionInput | undefined;
    const workflow = defineSubagentWorkflow(
      { name: "test", description: "test agent" },
      async (_prompt, sessionInput) => {
        capturedSession = sessionInput;
        return { toolResponse: "ok", data: null, threadId: "t" };
      }
    );

    // Validation will throw because destroySandbox is missing, but sessionInput is captured first
    try {
      await workflow("go", { sandboxShutdown: "keep-until-parent-close" });
    } catch {
      // expected — no destroySandbox callback
    }
    expect(capturedSession?.sandboxShutdown).toBe("keep-until-parent-close");
  });
});
