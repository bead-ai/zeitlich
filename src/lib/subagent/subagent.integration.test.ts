import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@temporalio/workflow", () => {
  let counter = 0;
  return {
    workflowInfo: () => ({ taskQueue: "default-queue" }),
    executeChild: vi.fn(async (_workflow: unknown, opts: { args: unknown[] }) => {
      const input = (opts.args as [{ prompt: string }])[0];
      return {
        toolResponse: `Response to: ${input.prompt}`,
        data: { result: "child-data" },
        threadId: "child-thread-1",
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    }),
    uuid4: () => {
      counter++;
      const bytes = Array.from({ length: 16 }, (_, i) =>
        ((counter * 31 + i * 7) & 0xff).toString(16).padStart(2, "0"),
      ).join("");
      return `${bytes.slice(0, 8)}-${bytes.slice(8, 12)}-${bytes.slice(12, 16)}-${bytes.slice(16, 20)}-${bytes.slice(20, 32)}`;
    },
  };
});

import { createSubagentTool, SUBAGENT_TOOL_NAME } from "./tool";
import { createSubagentHandler } from "./handler";
import { buildSubagentRegistration } from "./register";
import { bindSubagentState } from "./bind";
import { defineSubagentWorkflow } from "./workflow";
import type { SubagentConfig, SubagentSessionInput } from "./types";
import type { AgentStateManager } from "../state/types";

// ---------------------------------------------------------------------------
// createSubagentTool
// ---------------------------------------------------------------------------

describe("createSubagentTool", () => {
  it("creates tool with correct name and schema for single subagent", () => {
    const tool = createSubagentTool([
      {
        agentName: "researcher",
        description: "Researches topics",
        workflow: "researcherWorkflow",
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
        workflow: "researcherWorkflow",
      },
      {
        agentName: "writer",
        description: "Writes",
        workflow: "writerWorkflow",
      },
    ]);

    const validResearcher = tool.schema.safeParse({
      subagent: "researcher",
      description: "desc",
      prompt: "prompt",
    });
    expect(validResearcher.success).toBe(true);

    const validWriter = tool.schema.safeParse({
      subagent: "writer",
      description: "desc",
      prompt: "prompt",
    });
    expect(validWriter.success).toBe(true);

    const invalidAgent = tool.schema.safeParse({
      subagent: "nonexistent",
      description: "desc",
      prompt: "prompt",
    });
    expect(invalidAgent.success).toBe(false);
  });

  it("adds threadId field when allowThreadContinuation is set", () => {
    const tool = createSubagentTool([
      {
        agentName: "agent",
        description: "supports continuation",
        workflow: "workflow",
        allowThreadContinuation: true,
      },
    ]);

    const withThread = tool.schema.safeParse({
      subagent: "agent",
      description: "desc",
      prompt: "prompt",
      threadId: "some-thread",
    });
    expect(withThread.success).toBe(true);

    const withNull = tool.schema.safeParse({
      subagent: "agent",
      description: "desc",
      prompt: "prompt",
      threadId: null,
    });
    expect(withNull.success).toBe(true);
  });

  it("does not include threadId field when no subagent has allowThreadContinuation", () => {
    const tool = createSubagentTool([
      {
        agentName: "basic",
        description: "basic agent",
        workflow: "workflow",
      },
    ]);

    const result = tool.schema.safeParse({
      subagent: "basic",
      description: "desc",
      prompt: "prompt",
      threadId: "should-strip",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("threadId");
    }
  });

  it("throws when no subagents are provided", () => {
    expect(() => createSubagentTool([])).toThrow(
      "createSubagentTool requires at least one subagent",
    );
  });

  it("includes thread continuation note in description", () => {
    const tool = createSubagentTool([
      {
        agentName: "cont-agent",
        description: "Supports continuation",
        workflow: "workflow",
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
    workflow: "researcherWorkflow",
  };

  it("executes child workflow and returns response", async () => {
    const handler = createSubagentHandler([basicSubagent]);

    const result = await handler(
      { subagent: "researcher", description: "test", prompt: "Find info" },
      { threadId: "parent-thread", toolCallId: "tc-1", toolName: "Subagent" },
    );

    expect(result.toolResponse).toContain("Response to: Find info");
    expect(result.data).toEqual({ result: "child-data" });
  });

  it("throws for unknown subagent name", async () => {
    const handler = createSubagentHandler([basicSubagent]);

    await expect(
      handler(
        { subagent: "nonexistent", description: "test", prompt: "test" },
        { threadId: "t", toolCallId: "tc", toolName: "Subagent" },
      ),
    ).rejects.toThrow("Unknown subagent: nonexistent");
  });

  it("includes available subagent names in error message", async () => {
    const handler = createSubagentHandler([
      basicSubagent,
      {
        agentName: "writer",
        description: "Writes",
        workflow: "writerWorkflow",
      },
    ]);

    await expect(
      handler(
        { subagent: "bad", description: "test", prompt: "test" },
        { threadId: "t", toolCallId: "tc", toolName: "Subagent" },
      ),
    ).rejects.toThrow(/researcher.*writer/);
  });

  it("validates result against resultSchema", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    (executeChild as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      toolResponse: "result",
      data: { invalid: "data" },
      threadId: "child-t",
    });

    const validatedSubagent: SubagentConfig = {
      agentName: "validated",
      description: "Has validation",
      workflow: "workflow",
      resultSchema: z.object({ expected: z.string() }),
    };

    const handler = createSubagentHandler([validatedSubagent]);

    const result = await handler(
      { subagent: "validated", description: "test", prompt: "test" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" },
    );

    expect(result.toolResponse).toContain("invalid data");
    expect(result.data).toBeNull();
  });

  it("appends thread ID when allowThreadContinuation is set", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    (executeChild as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      toolResponse: "Some response",
      data: null,
      threadId: "child-thread-99",
    });

    const contSubagent: SubagentConfig = {
      agentName: "cont",
      description: "Continues threads",
      workflow: "workflow",
      allowThreadContinuation: true,
    };

    const handler = createSubagentHandler([contSubagent]);

    const result = await handler(
      { subagent: "cont", description: "test", prompt: "test" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" },
    );

    expect(result.toolResponse).toContain("Thread ID: child-thread-99");
  });

  it("returns fallback when child workflow returns no toolResponse", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    (executeChild as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      toolResponse: null,
      data: null,
      threadId: "child-t",
    });

    const handler = createSubagentHandler([basicSubagent]);

    const result = await handler(
      { subagent: "researcher", description: "test", prompt: "test" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" },
    );

    expect(result.toolResponse).toContain("no response");
    expect(result.data).toBeNull();
  });

  it("passes sandboxId to child when sandbox is inherit", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;
    execMock.mockResolvedValueOnce({
      toolResponse: "ok",
      data: null,
      threadId: "child-t",
    });

    const inheritSubagent: SubagentConfig = {
      agentName: "inherit-agent",
      description: "Inherits sandbox",
      workflow: "workflow",
      sandbox: "inherit",
    };

    const handler = createSubagentHandler([inheritSubagent]);

    await handler(
      { subagent: "inherit-agent", description: "test", prompt: "test" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent", sandboxId: "parent-sb" },
    );

    const lastCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected exec call");
    const input = lastCall[1].args[0];
    expect(input.sandboxId).toBe("parent-sb");
  });

  it("does not pass sandboxId when sandbox is own", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;
    execMock.mockResolvedValueOnce({
      toolResponse: "ok",
      data: null,
      threadId: "child-t",
    });

    const ownSubagent: SubagentConfig = {
      agentName: "own-agent",
      description: "Own sandbox",
      workflow: "workflow",
      sandbox: "own",
    };

    const handler = createSubagentHandler([ownSubagent]);

    await handler(
      { subagent: "own-agent", description: "test", prompt: "test" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent", sandboxId: "parent-sb" },
    );

    const lastCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected exec call");
    const input = lastCall[1].args[0];
    expect(input.sandboxId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createSubagentHandler — resolveSettings
// ---------------------------------------------------------------------------

describe("createSubagentHandler — resolveSettings", () => {
  it("injects settings from resolveSettings into child input", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;
    execMock.mockResolvedValueOnce({
      toolResponse: "ok",
      data: null,
      threadId: "child-t",
    });

    const settingsSubagent: SubagentConfig = {
      agentName: "settings-agent",
      description: "Has settings",
      workflow: "workflow",
      resolveSettings: () => ({ model: "gpt-4", temperature: 0.7 }),
    };

    const handler = createSubagentHandler([settingsSubagent]);

    await handler(
      { subagent: "settings-agent", description: "test", prompt: "test" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" },
    );

    const lastCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected exec call");
    const input = lastCall[1].args[0];
    expect(input.settings).toEqual({ model: "gpt-4", temperature: 0.7 });
  });

  it("calls resolveSettings on each invocation (dynamic)", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;
    execMock.mockResolvedValue({
      toolResponse: "ok",
      data: null,
      threadId: "child-t",
    });

    let callCount = 0;
    const dynamicSubagent: SubagentConfig = {
      agentName: "dynamic-agent",
      description: "Dynamic settings",
      workflow: "workflow",
      resolveSettings: () => {
        callCount++;
        return { invocation: callCount };
      },
    };

    const handler = createSubagentHandler([dynamicSubagent]);

    await handler(
      { subagent: "dynamic-agent", description: "test", prompt: "first" },
      { threadId: "t", toolCallId: "tc1", toolName: "Subagent" },
    );

    await handler(
      { subagent: "dynamic-agent", description: "test", prompt: "second" },
      { threadId: "t", toolCallId: "tc2", toolName: "Subagent" },
    );

    const calls = execMock.mock.calls;
    const penultimate = calls[calls.length - 2];
    const last = calls[calls.length - 1];
    if (!penultimate || !last) throw new Error("expected two exec calls");
    expect(penultimate[1].args[0].settings).toEqual({ invocation: 1 });
    expect(last[1].args[0].settings).toEqual({ invocation: 2 });
  });

  it("does not include settings when resolveSettings is not configured", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;
    execMock.mockResolvedValueOnce({
      toolResponse: "ok",
      data: null,
      threadId: "child-t",
    });

    const plainSubagent: SubagentConfig = {
      agentName: "plain",
      description: "No settings",
      workflow: "workflow",
    };

    const handler = createSubagentHandler([plainSubagent]);

    await handler(
      { subagent: "plain", description: "test", prompt: "test" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" },
    );

    const lastCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected exec call");
    const input = lastCall[1].args[0];
    expect(input.settings).toBeUndefined();
  });

  it("passes both context and settings when both are configured", async () => {
    const { executeChild } = await import("@temporalio/workflow");
    const execMock = executeChild as ReturnType<typeof vi.fn>;
    execMock.mockResolvedValueOnce({
      toolResponse: "ok",
      data: null,
      threadId: "child-t",
    });

    const bothSubagent: SubagentConfig = {
      agentName: "both-agent",
      description: "Context + settings",
      workflow: "workflow",
      context: { apiKey: "static-key" },
      resolveSettings: () => ({ model: "gpt-4" }),
    };

    const handler = createSubagentHandler([bothSubagent]);

    await handler(
      { subagent: "both-agent", description: "test", prompt: "test" },
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" },
    );

    const lastCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected exec call");
    const input = lastCall[1].args[0];
    expect(input.context).toEqual({ apiKey: "static-key" });
    expect(input.settings).toEqual({ model: "gpt-4" });
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
        workflow: "workflow",
      },
    ]);

    expect(reg).not.toBeNull();
    expect(reg).toBeDefined();
    if (reg) {
      expect(reg.name).toBe(SUBAGENT_TOOL_NAME);
      expect(typeof reg.handler).toBe("function");
    }
  });

  it("enabled getter reflects dynamic subagent state", () => {
    const config: SubagentConfig = {
      agentName: "toggle",
      description: "Toggleable",
      workflow: "workflow",
      enabled: true,
    };

    const reg = buildSubagentRegistration([config]);
    expect(reg).toBeDefined();
    if (!reg) return;
    expect(reg.enabled).toBe(true);

    config.enabled = false;
    expect(reg.enabled).toBe(false);
  });

  it("disabled when all subagents are disabled", () => {
    const reg = buildSubagentRegistration([
      {
        agentName: "off",
        description: "Disabled",
        workflow: "workflow",
        enabled: false,
      },
    ]);

    expect(reg).toBeDefined();
    if (reg) {
      expect(reg.enabled).toBe(false);
    }
  });

  it("includes hooks when subagents have hooks configured", () => {
    const hookSpy = vi.fn(async () => ({}));

    const reg = buildSubagentRegistration([
      {
        agentName: "hooked",
        description: "Has hooks",
        workflow: "workflow",
        hooks: {
          onPreExecution: hookSpy,
        },
      },
    ]);

    expect(reg).toBeDefined();
    if (reg) {
      expect(reg.hooks).toBeDefined();
      if (reg.hooks) {
        expect(reg.hooks.onPreToolUse).toBeDefined();
      }
    }
  });

  it("does not include hooks when no subagents have hooks", () => {
    const reg = buildSubagentRegistration([
      {
        agentName: "plain",
        description: "No hooks",
        workflow: "workflow",
      },
    ]);

    expect(reg).toBeDefined();
    if (reg) {
      expect(reg.hooks).toBeUndefined();
    }
  });

  it("dynamic schema/description updates when subagents change enabled state", () => {
    const config1: SubagentConfig = {
      agentName: "a",
      description: "Agent A",
      workflow: "workflow",
      enabled: true,
    };
    const config2: SubagentConfig = {
      agentName: "b",
      description: "Agent B",
      workflow: "workflow",
      enabled: true,
    };

    const reg = buildSubagentRegistration([config1, config2]);

    expect(reg).toBeDefined();
    if (reg) {
      expect(reg.description).toContain("Agent A");
      expect(reg.description).toContain("Agent B");

      config2.enabled = false;

      expect(reg.description).toContain("Agent A");
      expect(reg.description).not.toContain("Agent B");
    }
  });
});

// ---------------------------------------------------------------------------
// bindSubagentState
// ---------------------------------------------------------------------------

describe("bindSubagentState", () => {
  interface TestState { model: string; apiKey: string; verbose: boolean }

  function createMockStateManager(state: TestState): AgentStateManager<TestState> {
    return {
      get: <K extends keyof TestState>(key: K) => state[key],
    } as AgentStateManager<TestState>;
  }

  it("picks specified keys from state manager", () => {
    const sm = createMockStateManager({ model: "gpt-4", apiKey: "sk-123", verbose: true });
    const resolve = bindSubagentState(sm, ["model", "apiKey"]);

    expect(resolve()).toEqual({ model: "gpt-4", apiKey: "sk-123" });
  });

  it("reflects latest state on each call", () => {
    const state: TestState = { model: "gpt-4", apiKey: "sk-123", verbose: false };
    const sm = createMockStateManager(state);
    const resolve = bindSubagentState(sm, ["model"]);

    expect(resolve()).toEqual({ model: "gpt-4" });

    state.model = "gpt-4o";
    expect(resolve()).toEqual({ model: "gpt-4o" });
  });

  it("returns all specified keys", () => {
    const sm = createMockStateManager({ model: "gpt-4", apiKey: "sk-123", verbose: true });
    const resolve = bindSubagentState(sm, ["model", "apiKey", "verbose"]);

    expect(resolve()).toEqual({ model: "gpt-4", apiKey: "sk-123", verbose: true });
  });

  it("returns empty object for empty keys array", () => {
    const sm = createMockStateManager({ model: "gpt-4", apiKey: "sk-123", verbose: true });
    const resolve = bindSubagentState(sm, []);

    expect(resolve()).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// defineSubagentWorkflow
// ---------------------------------------------------------------------------

describe("defineSubagentWorkflow", () => {
  it("maps previousThreadId to threadId + continueThread", async () => {
    let capturedSession: SubagentSessionInput | undefined;

    const workflow = defineSubagentWorkflow(async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { toolResponse: "ok", data: null, threadId: "t" };
    });

    await workflow({ prompt: "go", previousThreadId: "prev-42" });

    expect(capturedSession).toEqual({
      threadId: "prev-42",
      continueThread: true,
    });
  });

  it("maps sandboxId", async () => {
    let capturedSession: SubagentSessionInput | undefined;

    const workflow = defineSubagentWorkflow(async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { toolResponse: "ok", data: null, threadId: "t" };
    });

    await workflow({ prompt: "go", sandboxId: "sb-123" });

    expect(capturedSession).toEqual({ sandboxId: "sb-123" });
  });

  it("maps both previousThreadId and sandboxId together", async () => {
    let capturedSession: SubagentSessionInput | undefined;

    const workflow = defineSubagentWorkflow(async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { toolResponse: "ok", data: null, threadId: "t" };
    });

    await workflow({ prompt: "go", previousThreadId: "prev-1", sandboxId: "sb-1" });

    expect(capturedSession).toEqual({
      threadId: "prev-1",
      continueThread: true,
      sandboxId: "sb-1",
    });
  });

  it("returns empty sessionInput when no previousThreadId or sandboxId", async () => {
    let capturedSession: SubagentSessionInput | undefined;

    const workflow = defineSubagentWorkflow(async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { toolResponse: "ok", data: null, threadId: "t" };
    });

    await workflow({ prompt: "go" });

    expect(capturedSession).toEqual({});
  });

  it("passes full SubagentInput as first argument", async () => {
    let capturedInput: unknown;

    const workflow = defineSubagentWorkflow(async (input, _sessionInput) => {
      capturedInput = input;
      return { toolResponse: "ok", data: null, threadId: "t" };
    });

    await workflow({
      prompt: "research",
      context: { key: "val" },
      settings: { model: "gpt-4" },
      previousThreadId: "prev",
      sandboxId: "sb",
    });

    expect(capturedInput).toEqual({
      prompt: "research",
      context: { key: "val" },
      settings: { model: "gpt-4" },
      previousThreadId: "prev",
      sandboxId: "sb",
    });
  });

  it("returns the handler response unchanged", async () => {
    const workflow = defineSubagentWorkflow(async () => ({
      toolResponse: "result text",
      data: { count: 42 },
      threadId: "child-thread",
    }));

    const result = await workflow({ prompt: "go" });

    expect(result.toolResponse).toBe("result text");
    expect(result.data).toEqual({ count: 42 });
    expect(result.threadId).toBe("child-thread");
  });
});
