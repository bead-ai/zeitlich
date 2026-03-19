import { describe, expect, it, vi, afterEach } from "vitest";
import { z } from "zod";

let capturedSignalHandler:
  | ((payload: { childWorkflowId: string; result: unknown }) => void)
  | null = null;

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
    defineSignal: vi.fn((_name: string) => ({ __signal: true })),
    setHandler: vi.fn(
      (_signal: unknown, handler: (...a: unknown[]) => void) => {
        capturedSignalHandler = handler as typeof capturedSignalHandler;
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

        if (capturedSignalHandler) {
          capturedSignalHandler({ childWorkflowId: opts.workflowId, result });
        }

        return {
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
  capturedSignalHandler = null;
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

  it("adds threadId field when allowThreadContinuation is set", () => {
    const tool = createSubagentTool([
      {
        agentName: "agent",
        description: "supports continuation",
        workflow: mockWorkflow(),
        allowThreadContinuation: true,
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

  it("does not include threadId field when no subagent has allowThreadContinuation", () => {
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
        allowThreadContinuation: true,
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

  it("appends thread ID when allowThreadContinuation is set", async () => {
    nextStartChildResult = () => ({
      toolResponse: "Some response",
      data: null,
      threadId: "child-thread-99",
    });

    const contSubagent: SubagentConfig = {
      agentName: "cont",
      description: "Continues threads",
      workflow: mockWorkflow(),
      allowThreadContinuation: true,
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

  it("passes sandboxId to child when sandbox is inherit", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

    const inheritSubagent: SubagentConfig = {
      agentName: "inherit-agent",
      description: "Inherits sandbox",
      workflow: mockWorkflow(),
      sandbox: "inherit",
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
    expect(workflowInput.sandboxId).toBe("parent-sb");
  });

  it("throws when sandbox is inherit but parent has no sandbox", async () => {
    const inheritSubagent: SubagentConfig = {
      agentName: "inherit-agent",
      description: "Inherits sandbox",
      workflow: mockWorkflow(),
      sandbox: "inherit",
    };

    const { handler } = createSubagentHandler([inheritSubagent]);

    await expect(
      handler(
        { subagent: "inherit-agent", description: "test", prompt: "test" },
        { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
      )
    ).rejects.toThrow(
      'sandbox: "inherit" but the parent has no sandbox'
    );
  });

  it("does not pass sandboxId to child when sandbox is own", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

    const ownSubagent: SubagentConfig = {
      agentName: "own-agent",
      description: "Own sandbox",
      workflow: mockWorkflow(),
      sandbox: "own",
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
    expect(workflowInput.sandboxId).toBeUndefined();
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

  it("does not pass sandboxId when sandbox is own", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

    const ownSubagent: SubagentConfig = {
      agentName: "own-agent",
      description: "Own sandbox",
      workflow: mockWorkflow(),
      sandbox: "own",
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
    expect(workflowInput.sandboxId).toBeUndefined();
  });

  // --- Thread continuation ---

  it("passes previousThreadId when allowThreadContinuation and threadId provided", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

    const contSubagent: SubagentConfig = {
      agentName: "cont",
      description: "Continues",
      workflow: mockWorkflow(),
      allowThreadContinuation: true,
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
    expect(workflowInput.previousThreadId).toBe("prev-thread-42");
  });

  it("does not pass previousThreadId when allowThreadContinuation is false", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

    const noContSubagent: SubagentConfig = {
      agentName: "no-cont",
      description: "No continuation",
      workflow: mockWorkflow(),
      allowThreadContinuation: false,
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
    expect(workflowInput.previousThreadId).toBeUndefined();
  });

  // --- Sandbox continuation ---

  it("does not pass sandboxId when allowThreadContinuation is set (own sandbox)", async () => {
    const { startChild } = await import("@temporalio/workflow");
    const startMock = startChild as ReturnType<typeof vi.fn>;

    const contSandboxSubagent: SubagentConfig = {
      agentName: "sb-cont",
      description: "Sandbox continuation",
      workflow: mockWorkflow(),
      allowThreadContinuation: true,
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
    expect(workflowInput.sandboxId).toBeUndefined();
  });

  it("tracks sandbox ID and passes previousSandboxId on continuation", async () => {
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
      allowThreadContinuation: true,
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
    expect(workflowInput.previousThreadId).toBe("child-thread-A");
    expect(workflowInput.previousSandboxId).toBe("child-sb-1");
  });

  it("does not pass previousSandboxId without thread continuation", async () => {
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
      allowThreadContinuation: true,
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
    expect(workflowInput.previousSandboxId).toBeUndefined();
    expect(workflowInput.previousThreadId).toBeUndefined();
  });

  it("adds allowThreadContinuation subagent to pendingDestroys", async () => {
    const { getExternalWorkflowHandle } = await import("@temporalio/workflow");
    const handleMock = getExternalWorkflowHandle as ReturnType<typeof vi.fn>;
    const signalSpy = vi.fn();
    handleMock.mockReturnValue({ signal: signalSpy });

    const contSandboxSubagent: SubagentConfig = {
      agentName: "sb-cont",
      description: "Sandbox continuation",
      workflow: mockWorkflow(),
      allowThreadContinuation: true,
    };

    const { handler, destroySubagentSandboxes } = createSubagentHandler([
      contSandboxSubagent,
    ]);

    await handler(
      { subagent: "sb-cont", description: "test", prompt: "run" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    await destroySubagentSandboxes();

    expect(handleMock).toHaveBeenCalled();
    expect(signalSpy).toHaveBeenCalled();
  });

  it("signals destroy for sandbox=own subagents at cleanup", async () => {
    const { getExternalWorkflowHandle } = await import("@temporalio/workflow");
    const handleMock = getExternalWorkflowHandle as ReturnType<typeof vi.fn>;
    const signalSpy = vi.fn();
    handleMock.mockReturnValue({ signal: signalSpy });

    const ownSubagent: SubagentConfig = {
      agentName: "own-agent",
      description: "Own sandbox",
      workflow: mockWorkflow(),
      sandbox: "own",
    };

    const { handler, destroySubagentSandboxes } = createSubagentHandler([
      ownSubagent,
    ]);

    await handler(
      { subagent: "own-agent", description: "test", prompt: "run" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
    );

    await destroySubagentSandboxes();

    expect(handleMock).toHaveBeenCalled();
    expect(signalSpy).toHaveBeenCalled();
  });

  it("does not signal destroy for inherit subagents", async () => {
    const { getExternalWorkflowHandle } = await import("@temporalio/workflow");
    const handleMock = getExternalWorkflowHandle as ReturnType<typeof vi.fn>;
    handleMock.mockClear();

    const inheritSubagent: SubagentConfig = {
      agentName: "inherit-agent",
      description: "Inherits sandbox",
      workflow: mockWorkflow(),
      sandbox: "inherit",
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

    expect(handleMock).not.toHaveBeenCalled();
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
    expect(workflowInput.sandboxId).toBeUndefined();
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
    expect(workflowInput.sandboxId).toBeUndefined();
  });

  it("does not signal destroy for none subagents", async () => {
    const { getExternalWorkflowHandle } = await import("@temporalio/workflow");
    const handleMock = getExternalWorkflowHandle as ReturnType<typeof vi.fn>;
    handleMock.mockClear();

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

    await destroySubagentSandboxes();

    expect(handleMock).not.toHaveBeenCalled();
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
      sandbox: "own",
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
  it("maps previousThreadId to threadId + continueThread", async () => {
    let capturedSession: SubagentSessionInput | undefined;

    const workflow = defineSubagentWorkflow(
      { name: "test", description: "test agent" },
      async (_prompt, sessionInput) => {
        capturedSession = sessionInput;
        return { toolResponse: "ok", data: null, threadId: "t" };
      }
    );

    await workflow("go", { previousThreadId: "prev-42" });

    expect(capturedSession).toEqual({
      agentName: "test",
      threadId: "prev-42",
      continueThread: true,
    });
  });

  it("maps sandboxId", async () => {
    let capturedSession: SubagentSessionInput | undefined;
    const workflow = defineSubagentWorkflow(
      { name: "test", description: "test agent" },
      async (_prompt, sessionInput) => {
        capturedSession = sessionInput;
        return { toolResponse: "ok", data: null, threadId: "t" };
      }
    );

    await workflow("go", { sandboxId: "sb-123" });
    expect(capturedSession).toEqual({
      agentName: "test",
      sandboxId: "sb-123",
    });
  });

  it("maps previousSandboxId", async () => {
    let capturedSession: SubagentSessionInput | undefined;
    const workflow = defineSubagentWorkflow(
      { name: "test", description: "test agent" },
      async (_prompt, sessionInput) => {
        capturedSession = sessionInput;
        return { toolResponse: "ok", data: null, threadId: "t" };
      }
    );

    await workflow("go", { previousSandboxId: "prev-sb-1" });
    expect(capturedSession).toEqual({
      agentName: "test",
      previousSandboxId: "prev-sb-1",
    });
  });

  it("maps both previousThreadId and previousSandboxId together", async () => {
    let capturedSession: SubagentSessionInput | undefined;
    const workflow = defineSubagentWorkflow(
      { name: "test", description: "test agent" },
      async (_prompt, sessionInput) => {
        capturedSession = sessionInput;
        return { toolResponse: "ok", data: null, threadId: "t" };
      }
    );

    await workflow("go", {
      previousThreadId: "prev-t",
      previousSandboxId: "prev-sb",
    });
    expect(capturedSession).toEqual({
      agentName: "test",
      threadId: "prev-t",
      continueThread: true,
      previousSandboxId: "prev-sb",
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
    expect(capturedSession).toEqual({ agentName: "test" });
  });
});
