import { describe, expect, it, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { ToolResultConfig, TokenUsage } from "../types";
import type { ThreadOps } from "./types";
import type { RunAgentActivity } from "../model/types";
import type { RawToolCall } from "../tool-router/types";
import type { SandboxOps } from "../sandbox/types";
import type { ActivityInterfaceFor } from "@temporalio/workflow";

// ---------------------------------------------------------------------------
// Mock @temporalio/workflow
// ---------------------------------------------------------------------------

let idCounter = 0;

const startChildLog: { workflow: unknown; options: unknown }[] = [];
const signalLog: { workflowId: string; signal: unknown }[] = [];
let getExternalWorkflowHandleShouldThrow = false;

vi.mock("@temporalio/workflow", () => {
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
    proxyActivities: <T>() => ({}) as T,
    condition: async (fn: () => boolean) => fn(),
    defineUpdate: (name: string) => ({ __type: "update", name }),
    defineQuery: (name: string) => ({ __type: "query", name }),
    defineSignal: (name: string) => ({ __type: "signal", name }),
    setHandler: (_def: unknown, _handler: unknown) => {},
    uuid4: () => `00000000-0000-0000-0000-${String(++idCounter).padStart(12, "0")}`,
    ApplicationFailure: MockApplicationFailure,
    ParentClosePolicy: {
      ABANDON: "ABANDON",
      TERMINATE: "TERMINATE",
      REQUEST_CANCEL: "REQUEST_CANCEL",
      PARENT_CLOSE_POLICY_ABANDON: "ABANDON",
      PARENT_CLOSE_POLICY_TERMINATE: "TERMINATE",
      PARENT_CLOSE_POLICY_REQUEST_CANCEL: "REQUEST_CANCEL",
    },
    startChild: async (workflow: unknown, options: unknown) => {
      startChildLog.push({ workflow, options });
      return { workflowId: (options as { workflowId?: string })?.workflowId };
    },
    getExternalWorkflowHandle: (workflowId: string) => {
      if (getExternalWorkflowHandleShouldThrow) {
        throw new Error("Workflow not found");
      }
      return {
        signal: async (signalDef: unknown) => {
          signalLog.push({ workflowId, signal: signalDef });
        },
        cancel: async () => {},
      };
    },
  };
});

import { createSession } from "./session";
import { createAgentStateManager } from "../state/manager";
import { defineTool } from "../tool-router/router";
import type { ToolHandlerResponse, RouterContext } from "../tool-router/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function at<T>(arr: T[], index: number): T {
  const val = arr[index];
  if (val === undefined) throw new Error(`Index ${index} out of bounds`);
  return val;
}

function toActivityInterface(
  raw: ThreadOps,
): ActivityInterfaceFor<ThreadOps> {
  const result = {} as Record<string, unknown>;
  for (const [key, fn] of Object.entries(raw)) {
    const wrapped = (...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args);
    wrapped.executeWithOptions = (_opts: unknown, args: unknown[]) =>
      (fn as (...a: unknown[]) => unknown)(...args);
    result[key] = wrapped;
  }
  return result as ActivityInterfaceFor<ThreadOps>;
}

function createMockThreadOps() {
  const log: { op: string; args: unknown[] }[] = [];

  const ops = toActivityInterface({
    initializeThread: async (threadId) => {
      log.push({ op: "initializeThread", args: [threadId] });
    },
    appendHumanMessage: async (threadId, content) => {
      log.push({ op: "appendHumanMessage", args: [threadId, content] });
    },
    appendToolResult: async (config) => {
      log.push({ op: "appendToolResult", args: [config] });
    },
    appendSystemMessage: async (threadId, content) => {
      log.push({ op: "appendSystemMessage", args: [threadId, content] });
    },
    forkThread: async (source, target) => {
      log.push({ op: "forkThread", args: [source, target] });
    },
  });

  return { ops, log };
}

type TurnScript = {
  message: unknown;
  toolCalls: RawToolCall[];
  usage?: TokenUsage;
};

function createScriptedRunAgent(turns: TurnScript[]): RunAgentActivity<unknown> {
  let call = 0;
  return async () => {
    const turn = turns[call++];
    if (!turn) {
      return { message: "done", rawToolCalls: [], usage: undefined };
    }
    return {
      message: turn.message,
      rawToolCalls: turn.toolCalls,
      usage: turn.usage,
    };
  };
}

function createEchoTool() {
  return defineTool({
    name: "Echo" as const,
    description: "echoes input",
    schema: z.object({ text: z.string() }),
    handler: async (
      args: { text: string },
      _ctx: RouterContext,
    ): Promise<ToolHandlerResponse<{ echoed: string }>> => ({
      toolResponse: `Echo: ${args.text}`,
      data: { echoed: args.text },
    }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createSession integration", () => {
  beforeEach(() => {
    idCounter = 0;
    startChildLog.length = 0;
    signalLog.length = 0;
    getExternalWorkflowHandleShouldThrow = false;
  });

  // --- Basic completion ---

  it("completes immediately when runAgent returns no tool calls", async () => {
    const { ops, log } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      threadId: "thread-1",
      runAgent: createScriptedRunAgent([
        { message: "Hello!", toolCalls: [] },
      ]),
      threadOps: ops,
      buildContextMessage: () => "What is 2+2?",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "You are a test assistant." },
    });

    const result = await session.runSession({ stateManager });

    expect(result.exitReason).toBe("completed");
    expect(result.finalMessage).toBe("Hello!");
    expect(result.threadId).toBe("thread-1");

    const systemOps = log.filter((l) => l.op === "appendSystemMessage");
    expect(systemOps).toHaveLength(1);
    expect(at(systemOps, 0).args[1]).toBe("You are a test assistant.");

    const humanOps = log.filter((l) => l.op === "appendHumanMessage");
    expect(humanOps).toHaveLength(1);
    expect(at(humanOps, 0).args[1]).toBe("What is 2+2?");
  });

  // --- Tool execution ---

  it("executes tool calls and completes on next turn", async () => {
    const { ops, log } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      threadId: "thread-1",
      runAgent: createScriptedRunAgent([
        {
          message: "Let me echo that.",
          toolCalls: [{ id: "tc-1", name: "Echo", args: { text: "hello" } }],
        },
        {
          message: "Done echoing.",
          toolCalls: [],
        },
      ]),
      threadOps: ops,
      tools: { Echo: createEchoTool() },
      buildContextMessage: () => "Echo hello for me.",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "You are a test assistant." },
    });

    const result = await session.runSession({ stateManager });

    expect(result.exitReason).toBe("completed");
    expect(result.finalMessage).toBe("Done echoing.");

    const toolResults = log.filter((l) => l.op === "appendToolResult");
    expect(toolResults).toHaveLength(1);
    const resultConfig = at(toolResults, 0).args[0] as ToolResultConfig;
    expect(resultConfig.toolName).toBe("Echo");
    expect(resultConfig.content).toBe("Echo: hello");
  });

  // --- Multi-turn loop ---

  it("runs multiple turns with tool calls before completing", async () => {
    const { ops } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      threadId: "thread-1",
      runAgent: createScriptedRunAgent([
        {
          message: "turn 1",
          toolCalls: [{ id: "tc-1", name: "Echo", args: { text: "one" } }],
        },
        {
          message: "turn 2",
          toolCalls: [{ id: "tc-2", name: "Echo", args: { text: "two" } }],
        },
        {
          message: "turn 3",
          toolCalls: [{ id: "tc-3", name: "Echo", args: { text: "three" } }],
        },
        {
          message: "final",
          toolCalls: [],
        },
      ]),
      threadOps: ops,
      tools: { Echo: createEchoTool() },
      buildContextMessage: () => "Count to three.",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "You are a test assistant." },
    });

    const result = await session.runSession({ stateManager });

    expect(result.exitReason).toBe("completed");
    expect(result.finalMessage).toBe("final");
    expect(result.usage.turns).toBe(4);
  });

  // --- MaxTurns limit ---

  it("stops at maxTurns and returns null finalMessage", async () => {
    const { ops } = createMockThreadOps();

    const infiniteAgent = createScriptedRunAgent(
      Array.from({ length: 10 }, (_, i) => ({
        message: `turn ${i + 1}`,
        toolCalls: [{ id: `tc-${i}`, name: "Echo", args: { text: `${i}` } }],
      })),
    );

    const session = await createSession({
      agentName: "TestAgent",
      threadId: "thread-1",
      maxTurns: 3,
      runAgent: infiniteAgent,
      threadOps: ops,
      tools: { Echo: createEchoTool() },
      buildContextMessage: () => "go",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "You are a test assistant." },
    });

    const result = await session.runSession({ stateManager });

    expect(result.exitReason).toBe("max_turns");
    expect(result.finalMessage).toBeNull();
    expect(result.usage.turns).toBe(3);
  });

  // --- Session hooks ---

  it("calls onSessionStart and onSessionEnd hooks", async () => {
    const { ops } = createMockThreadOps();
    const hookLog: string[] = [];

    const session = await createSession({
      agentName: "TestAgent",
      threadId: "thread-1",
      runAgent: createScriptedRunAgent([
        { message: "done", toolCalls: [] },
      ]),
      threadOps: ops,
      buildContextMessage: () => "hi",
      hooks: {
        onSessionStart: async ({ agentName, threadId }) => {
          hookLog.push(`start:${agentName}:${threadId}`);
        },
        onSessionEnd: async ({ agentName, exitReason, turns }) => {
          hookLog.push(`end:${agentName}:${exitReason}:${turns}`);
        },
      },
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    expect(hookLog).toEqual([
      "start:TestAgent:thread-1",
      "end:TestAgent:completed:1",
    ]);
  });

  // --- System prompt ---

  it("throws when system prompt is missing", async () => {
    const { ops } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      threadId: "thread-1",
      runAgent: createScriptedRunAgent([]),
      threadOps: ops,
      buildContextMessage: () => "hi",
    });

    const stateManager = createAgentStateManager({
      initialState: {},
    });

    await expect(session.runSession({ stateManager })).rejects.toThrow(
      "No system prompt in state",
    );
  });

  it("skips system prompt when appendSystemPrompt is false", async () => {
    const { ops, log } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      threadId: "thread-1",
      appendSystemPrompt: false,
      runAgent: createScriptedRunAgent([
        { message: "ok", toolCalls: [] },
      ]),
      threadOps: ops,
      buildContextMessage: () => "hi",
    });

    const stateManager = createAgentStateManager({
      initialState: {},
    });

    const result = await session.runSession({ stateManager });

    expect(result.exitReason).toBe("completed");
    const systemOps = log.filter((l) => l.op === "appendSystemMessage");
    expect(systemOps).toHaveLength(0);
    const initOps = log.filter((l) => l.op === "initializeThread");
    expect(initOps).toHaveLength(1);
  });

  // --- Token usage ---

  it("accumulates token usage across turns", async () => {
    const { ops } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      threadId: "thread-1",
      runAgent: createScriptedRunAgent([
        {
          message: "turn 1",
          toolCalls: [{ id: "tc-1", name: "Echo", args: { text: "a" } }],
          usage: { inputTokens: 100, outputTokens: 50 },
        },
        {
          message: "turn 2",
          toolCalls: [],
          usage: { inputTokens: 150, outputTokens: 75 },
        },
      ]),
      threadOps: ops,
      tools: { Echo: createEchoTool() },
      buildContextMessage: () => "go",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    const result = await session.runSession({ stateManager });

    expect(result.usage.totalInputTokens).toBe(250);
    expect(result.usage.totalOutputTokens).toBe(125);
    expect(result.usage.turns).toBe(2);
  });

  // --- Invalid tool calls ---

  it("appends error for invalid tool call args and continues", async () => {
    const { ops, log } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      threadId: "thread-1",
      runAgent: createScriptedRunAgent([
        {
          message: "bad call",
          toolCalls: [
            { id: "tc-bad", name: "Echo", args: { text: 999 } },
            { id: "tc-good", name: "Echo", args: { text: "valid" } },
          ],
        },
        {
          message: "done",
          toolCalls: [],
        },
      ]),
      threadOps: ops,
      tools: { Echo: createEchoTool() },
      buildContextMessage: () => "go",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    const result = await session.runSession({ stateManager });
    expect(result.exitReason).toBe("completed");

    const toolResults = log.filter((l) => l.op === "appendToolResult");
    // One error result for bad call + one success result for good call
    expect(toolResults.length).toBeGreaterThanOrEqual(2);
    const errorResult = toolResults.find((l) => {
      const config = l.args[0] as ToolResultConfig;
      return config.toolCallId === "tc-bad";
    });
    expect(errorResult).toBeDefined();
    const errorConfig = errorResult?.args[0] as ToolResultConfig | undefined;
    expect(errorConfig?.content).toContain("Invalid tool call");
  });

  // --- continueThread ---

  it("forks thread when continueThread is set", async () => {
    const { ops, log } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      threadId: "source-thread",
      continueThread: true,
      runAgent: createScriptedRunAgent([
        { message: "continued", toolCalls: [] },
      ]),
      threadOps: ops,
      buildContextMessage: () => "continue",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    const result = await session.runSession({ stateManager });

    expect(result.exitReason).toBe("completed");

    const forkOps = log.filter((l) => l.op === "forkThread");
    expect(forkOps).toHaveLength(1);
    expect(at(forkOps, 0).args[0]).toBe("source-thread");

    const systemOps = log.filter((l) => l.op === "appendSystemMessage");
    expect(systemOps).toHaveLength(0);
  });

  // --- Sandbox lifecycle ---

  it("creates and destroys sandbox when sandboxOps are provided", async () => {
    const { ops } = createMockThreadOps();
    const sandboxLog: string[] = [];

    const sandboxOps: SandboxOps = {
      createSandbox: async (options) => {
        sandboxLog.push(`create:${options?.id ?? "unknown"}`);
        return { sandboxId: `sb-${options?.id ?? "unknown"}` };
      },
      destroySandbox: async (sandboxId: string) => {
        sandboxLog.push(`destroy:${sandboxId}`);
      },
      pauseSandbox: async () => {},
      snapshotSandbox: async () => ({
        sandboxId: "sb-1",
        providerId: "test",
        data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async () => "forked-sandbox-id",
    };

    const session = await createSession({
      agentName: "TestAgent",
      threadId: "thread-1",
      runAgent: createScriptedRunAgent([
        { message: "done", toolCalls: [] },
      ]),
      threadOps: ops,
      buildContextMessage: () => "go",
      sandbox: sandboxOps,
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    expect(sandboxLog).toContain("create:thread-1");
    expect(sandboxLog).toContain("destroy:sb-thread-1");
  });

  it("does not create or destroy sandbox when sandboxId is inherited", async () => {
    const { ops } = createMockThreadOps();
    const sandboxLog: string[] = [];

    const sandboxOps: SandboxOps = {
      createSandbox: async () => {
        sandboxLog.push("create");
        return { sandboxId: "sb-new" };
      },
      destroySandbox: async () => {
        sandboxLog.push("destroy");
      },
      pauseSandbox: async () => {},
      snapshotSandbox: async () => ({
        sandboxId: "sb-1",
        providerId: "test",
        data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async () => "forked-sandbox-id",
    };

    const session = await createSession({
      agentName: "TestAgent",
      threadId: "thread-1",
      runAgent: createScriptedRunAgent([
        { message: "done", toolCalls: [] },
      ]),
      threadOps: ops,
      buildContextMessage: () => "go",
      sandbox: sandboxOps,
      sandboxId: "inherited-sb",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    expect(sandboxLog).toHaveLength(0);
  });

  // --- Sandbox ID passed to tool handlers ---

  it("passes sandbox ID to tool handlers via processToolCalls context", async () => {
    const { ops } = createMockThreadOps();
    let capturedSandboxId: string | undefined;

    const spyTool = defineTool({
      name: "Spy" as const,
      description: "captures context",
      schema: z.object({}),
      handler: async (_args: Record<string, never>, ctx: RouterContext) => {
        capturedSandboxId = ctx.sandboxId;
        return { toolResponse: "ok", data: null };
      },
    });

    const session = await createSession({
      agentName: "TestAgent",
      threadId: "thread-1",
      runAgent: createScriptedRunAgent([
        {
          message: "spy",
          toolCalls: [{ id: "tc-1", name: "Spy", args: {} }],
        },
        { message: "done", toolCalls: [] },
      ]),
      threadOps: ops,
      tools: { Spy: spyTool },
      buildContextMessage: () => "go",
      sandboxId: "my-sandbox",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    expect(capturedSandboxId).toBe("my-sandbox");
  });

  // --- Error propagation ---

  it("propagates runAgent errors and calls onSessionEnd with failed reason", async () => {
    const { ops } = createMockThreadOps();
    let endReason: string | undefined;

    const session = await createSession({
      agentName: "TestAgent",
      threadId: "thread-1",
      runAgent: async () => {
        throw new Error("LLM went down");
      },
      threadOps: ops,
      buildContextMessage: () => "go",
      hooks: {
        onSessionEnd: async ({ exitReason }) => {
          endReason = exitReason;
        },
      },
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await expect(session.runSession({ stateManager })).rejects.toThrow(
      "LLM went down",
    );

    expect(endReason).toBe("failed");
  });

  // --- Tool execution hooks within session ---

  it("fires global tool hooks during session tool processing", async () => {
    const { ops } = createMockThreadOps();
    const hookLog: string[] = [];

    const session = await createSession({
      agentName: "TestAgent",
      threadId: "thread-1",
      runAgent: createScriptedRunAgent([
        {
          message: "call echo",
          toolCalls: [{ id: "tc-1", name: "Echo", args: { text: "hi" } }],
        },
        { message: "done", toolCalls: [] },
      ]),
      threadOps: ops,
      tools: { Echo: createEchoTool() },
      buildContextMessage: () => "go",
      hooks: {
        onPreToolUse: async ({ toolCall }) => {
          hookLog.push(`pre:${toolCall.name}`);
          return {};
        },
        onPostToolUse: async ({ toolCall }) => {
          hookLog.push(`post:${toolCall.name}`);
        },
      },
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    expect(hookLog).toEqual(["pre:Echo", "post:Echo"]);
  });

  // --- Generated thread IDs ---

  it("generates a thread ID when none is provided", async () => {
    const { ops } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      runAgent: createScriptedRunAgent([
        { message: "done", toolCalls: [] },
      ]),
      threadOps: ops,
      buildContextMessage: () => "go",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    const result = await session.runSession({ stateManager });

    expect(result.threadId).toBeTruthy();
    expect(result.threadId.length).toBeGreaterThan(0);
  });

  // --- Multiple tools in a single turn ---

  it("handles multiple tool calls in a single turn", async () => {
    const { ops, log } = createMockThreadOps();

    const addTool = defineTool({
      name: "Add" as const,
      description: "adds numbers",
      schema: z.object({ a: z.number(), b: z.number() }),
      handler: async (args: { a: number; b: number }) => ({
        toolResponse: `${args.a + args.b}`,
        data: { sum: args.a + args.b },
      }),
    });

    const session = await createSession({
      agentName: "TestAgent",
      threadId: "thread-1",
      runAgent: createScriptedRunAgent([
        {
          message: "computing",
          toolCalls: [
            { id: "tc-1", name: "Echo", args: { text: "hello" } },
            { id: "tc-2", name: "Add", args: { a: 3, b: 4 } },
          ],
        },
        { message: "all done", toolCalls: [] },
      ]),
      threadOps: ops,
      tools: { Echo: createEchoTool(), Add: addTool },
      buildContextMessage: () => "go",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    const result = await session.runSession({ stateManager });

    expect(result.exitReason).toBe("completed");
    expect(result.finalMessage).toBe("all done");

    const toolResults = log.filter((l) => l.op === "appendToolResult");
    expect(toolResults).toHaveLength(2);
  });

  // --- buildContextMessage async ---

  it("supports async buildContextMessage", async () => {
    const { ops, log } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      threadId: "thread-1",
      runAgent: createScriptedRunAgent([
        { message: "done", toolCalls: [] },
      ]),
      threadOps: ops,
      buildContextMessage: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return "async context";
      },
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    const humanOps = log.filter((l) => l.op === "appendHumanMessage");
    expect(at(humanOps, 0).args[1]).toBe("async context");
  });

  // --- Sandbox stateUpdate merge ---

  it("merges sandbox stateUpdate into state manager", async () => {
    const { ops } = createMockThreadOps();

    const sandboxOps: SandboxOps = {
      createSandbox: async () => ({
        sandboxId: "sb-1",
        stateUpdate: { customField: "from-sandbox" },
      }),
      destroySandbox: async () => {},
      pauseSandbox: async () => {},
      snapshotSandbox: async () => ({
        sandboxId: "sb-1",
        providerId: "test",
        data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async () => "forked-sandbox-id",
    };

    const session = await createSession({
      agentName: "TestAgent",
      threadId: "thread-1",
      runAgent: createScriptedRunAgent([
        { message: "done", toolCalls: [] },
      ]),
      threadOps: ops,
      buildContextMessage: () => "go",
      sandbox: sandboxOps,
    });

    const stateManager = createAgentStateManager<{ customField: string }>({
      initialState: { systemPrompt: "test", customField: "" },
    });

    await session.runSession({ stateManager });

    expect(stateManager.get("customField")).toBe("from-sandbox");
  });

  // --- Tool usage tracking from tool results ---

  it("accumulates usage from tool call results", async () => {
    const { ops } = createMockThreadOps();

    const usageTool = defineTool({
      name: "UsageTool" as const,
      description: "returns usage",
      schema: z.object({}),
      handler: async () => ({
        toolResponse: "ok",
        data: null,
        usage: { inputTokens: 50, outputTokens: 25 },
      }),
    });

    const session = await createSession({
      agentName: "TestAgent",
      threadId: "thread-1",
      runAgent: createScriptedRunAgent([
        {
          message: "t1",
          toolCalls: [{ id: "tc-1", name: "UsageTool", args: {} }],
          usage: { inputTokens: 100, outputTokens: 50 },
        },
        { message: "done", toolCalls: [], usage: { inputTokens: 80, outputTokens: 40 } },
      ]),
      threadOps: ops,
      tools: { UsageTool: usageTool },
      buildContextMessage: () => "go",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    const result = await session.runSession({ stateManager });

    // runAgent usage: 100+80=180 input, 50+40=90 output
    // Note: handler-level usage is not forwarded through router results
    expect(result.usage.totalInputTokens).toBe(180);
    expect(result.usage.totalOutputTokens).toBe(90);
  });

  // --- Sandbox reaper lifecycle ---

  it("starts a reaper workflow when pauseSandboxOnExit and sandboxReaper are set", async () => {
    const { ops } = createMockThreadOps();
    const sandboxLog: string[] = [];

    const sandboxOps: SandboxOps = {
      createSandbox: async (options) => {
        sandboxLog.push(`create:${options?.id ?? "unknown"}`);
        return { sandboxId: `sb-${options?.id ?? "unknown"}` };
      },
      destroySandbox: async (id) => { sandboxLog.push(`destroy:${id}`); },
      pauseSandbox: async (id, ttl) => { sandboxLog.push(`pause:${id}:${ttl}`); },
      snapshotSandbox: async () => ({
        sandboxId: "sb-1", providerId: "test", data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async () => "forked-sandbox-id",
    };

    const fakeReaper = async () => {};

    const session = await createSession({
      agentName: "TestAgent",
      threadId: "thread-1",
      runAgent: createScriptedRunAgent([
        { message: "done", toolCalls: [] },
      ]),
      threadOps: ops,
      buildContextMessage: () => "go",
      sandbox: sandboxOps,
      pauseSandboxOnExit: { ttlSeconds: 120 },
      sandboxReaper: { workflow: fakeReaper, ttlMs: 120_000 },
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    expect(sandboxLog).toContain("pause:sb-thread-1:120");
    expect(sandboxLog).not.toContain("destroy:sb-thread-1");

    expect(startChildLog).toHaveLength(1);
    const reaperCall = at(startChildLog, 0);
    expect(reaperCall.workflow).toBe(fakeReaper);
    const reaperOpts = reaperCall.options as {
      workflowId: string;
      args: [string, number];
      parentClosePolicy: string;
    };
    expect(reaperOpts.workflowId).toBe("sandbox-reaper-sb-thread-1");
    expect(reaperOpts.args).toEqual(["sb-thread-1", 120_000]);
    expect(reaperOpts.parentClosePolicy).toBe("ABANDON");
  });

  it("does not start a reaper when pauseSandboxOnExit is false", async () => {
    const { ops } = createMockThreadOps();
    const sandboxLog: string[] = [];

    const sandboxOps: SandboxOps = {
      createSandbox: async (options) => {
        return { sandboxId: `sb-${options?.id ?? "unknown"}` };
      },
      destroySandbox: async (id) => { sandboxLog.push(`destroy:${id}`); },
      pauseSandbox: async (id) => { sandboxLog.push(`pause:${id}`); },
      snapshotSandbox: async () => ({
        sandboxId: "sb-1", providerId: "test", data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async () => "forked-sandbox-id",
    };

    const session = await createSession({
      agentName: "TestAgent",
      threadId: "thread-1",
      runAgent: createScriptedRunAgent([
        { message: "done", toolCalls: [] },
      ]),
      threadOps: ops,
      buildContextMessage: () => "go",
      sandbox: sandboxOps,
      sandboxReaper: { workflow: async () => {}, ttlMs: 60_000 },
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    expect(sandboxLog).toContain("destroy:sb-thread-1");
    expect(startChildLog).toHaveLength(0);
  });

  it("dismisses existing reaper before forking and starts new reaper on pause", async () => {
    const { ops } = createMockThreadOps();
    const sandboxLog: string[] = [];

    const sandboxOps: SandboxOps = {
      createSandbox: async () => ({ sandboxId: "sb-new" }),
      destroySandbox: async (id) => { sandboxLog.push(`destroy:${id}`); },
      pauseSandbox: async (id, ttl) => { sandboxLog.push(`pause:${id}:${ttl}`); },
      snapshotSandbox: async () => ({
        sandboxId: "sb-1", providerId: "test", data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async (id) => {
        sandboxLog.push(`fork:${id}`);
        return `forked-${id}`;
      },
    };

    const fakeReaper = async () => {};

    const session = await createSession({
      agentName: "TestAgent",
      threadId: "thread-1",
      runAgent: createScriptedRunAgent([
        { message: "done", toolCalls: [] },
      ]),
      threadOps: ops,
      buildContextMessage: () => "go",
      sandbox: sandboxOps,
      previousSandboxId: "sb-prev",
      pauseSandboxOnExit: { ttlSeconds: 60 },
      sandboxReaper: { workflow: fakeReaper, ttlMs: 60_000 },
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    // Dismissed the old reaper before forking
    expect(signalLog).toHaveLength(1);
    expect(at(signalLog, 0).workflowId).toBe("sandbox-reaper-sb-prev");

    // Forked the previous sandbox
    expect(sandboxLog).toContain("fork:sb-prev");

    // Paused the forked sandbox on exit (not destroyed)
    expect(sandboxLog).toContain("pause:forked-sb-prev:60");
    expect(sandboxLog).not.toContain("destroy:forked-sb-prev");

    // Started a new reaper for the forked sandbox
    expect(startChildLog).toHaveLength(1);
    const reaperOpts = at(startChildLog, 0).options as {
      workflowId: string;
      args: [string, number];
    };
    expect(reaperOpts.workflowId).toBe("sandbox-reaper-forked-sb-prev");
    expect(reaperOpts.args).toEqual(["forked-sb-prev", 60_000]);
  });

  it("tolerates missing reaper when forking from previousSandboxId", async () => {
    const { ops } = createMockThreadOps();

    getExternalWorkflowHandleShouldThrow = true;

    const sandboxOps: SandboxOps = {
      createSandbox: async () => ({ sandboxId: "sb-new" }),
      destroySandbox: async () => {},
      pauseSandbox: async () => {},
      snapshotSandbox: async () => ({
        sandboxId: "sb-1", providerId: "test", data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async (id) => `forked-${id}`,
    };

    const session = await createSession({
      agentName: "TestAgent",
      threadId: "thread-1",
      runAgent: createScriptedRunAgent([
        { message: "done", toolCalls: [] },
      ]),
      threadOps: ops,
      buildContextMessage: () => "go",
      sandbox: sandboxOps,
      previousSandboxId: "sb-old",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    const result = await session.runSession({ stateManager });
    expect(result.exitReason).toBe("completed");
  });
});

