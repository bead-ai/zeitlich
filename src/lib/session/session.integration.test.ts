import { describe, expect, it, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { ToolResultConfig, TokenUsage } from "../types";
import type { ThreadOps } from "./types";
import type { PersistedThreadState } from "../state/types";
import type { RunAgentActivity } from "../model/types";
import type { RawToolCall } from "../tool-router/types";
import type { SandboxOps } from "../sandbox/types";
import type { ActivityInterfaceFor } from "@temporalio/workflow";

// ---------------------------------------------------------------------------
// Mock @temporalio/workflow
// ---------------------------------------------------------------------------

let idCounter = 0;

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

  class MockCancellationScope {
    cancellable: boolean;
    constructor(opts?: { cancellable?: boolean }) {
      this.cancellable = opts?.cancellable ?? true;
    }
    async run<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    }
    cancel(): void {}
  }
  return {
    proxyActivities: <T>() => ({}) as T,
    condition: async (fn: () => boolean) => fn(),
    defineUpdate: (name: string) => ({ __type: "update", name }),
    defineQuery: (name: string) => ({ __type: "query", name }),
    defineSignal: (name: string) => ({ __type: "signal", name }),
    setHandler: (_def: unknown, _handler: unknown) => {},
    startChild: async () => ({ result: () => Promise.resolve(null) }),
    workflowInfo: () => ({ taskQueue: "default-queue" }),
    getExternalWorkflowHandle: () => ({ signal: async () => {} }),
    uuid4: () =>
      `00000000-0000-0000-0000-${String(++idCounter).padStart(12, "0")}`,
    ApplicationFailure: MockApplicationFailure,
    CancellationScope: MockCancellationScope,
    isCancellation: (_err: unknown) => false,
    log: {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
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

function toActivityInterface(raw: ThreadOps): ActivityInterfaceFor<ThreadOps> {
  const result = {} as Record<string, unknown>;
  for (const [key, fn] of Object.entries(raw)) {
    const wrapped = (...args: unknown[]) =>
      (fn as (...a: unknown[]) => unknown)(...args);
    wrapped.executeWithOptions = (_opts: unknown, args: unknown[]) =>
      (fn as (...a: unknown[]) => unknown)(...args);
    result[key] = wrapped;
  }
  return result as ActivityInterfaceFor<ThreadOps>;
}

function createMockThreadOps() {
  const log: { op: string; args: unknown[] }[] = [];
  const stateStore = new Map<string, PersistedThreadState>();

  const ops = toActivityInterface({
    initializeThread: async (threadId) => {
      log.push({ op: "initializeThread", args: [threadId] });
    },
    appendHumanMessage: async (threadId, id, content) => {
      log.push({ op: "appendHumanMessage", args: [threadId, id, content] });
    },
    appendToolResult: async (id, config) => {
      log.push({ op: "appendToolResult", args: [id, config] });
    },
    appendSystemMessage: async (threadId, id, content) => {
      log.push({ op: "appendSystemMessage", args: [threadId, id, content] });
    },
    appendAgentMessage: async (threadId, id, message) => {
      log.push({ op: "appendAgentMessage", args: [threadId, id, message] });
    },
    forkThread: async (source, target) => {
      log.push({ op: "forkThread", args: [source, target] });
      const src = stateStore.get(source);
      if (src) stateStore.set(target, src);
    },
    truncateThread: async (threadId, messageId) => {
      log.push({ op: "truncateThread", args: [threadId, messageId] });
    },
    loadThreadState: async (threadId) => {
      log.push({ op: "loadThreadState", args: [threadId] });
      return stateStore.get(threadId) ?? null;
    },
    saveThreadState: async (threadId, state) => {
      log.push({ op: "saveThreadState", args: [threadId, state] });
      stateStore.set(threadId, state);
    },
  });

  return { ops, log, stateStore };
}

type TurnScript = {
  message: unknown;
  toolCalls: RawToolCall[];
  usage?: TokenUsage;
};

function createScriptedRunAgent(
  turns: TurnScript[]
): RunAgentActivity<unknown> {
  let call = 0;
  return async () => {
    const turn = turns[call++];
    if (!turn) {
      return {
        message: "done",
        rawToolCalls: [],
        usage: undefined,
      };
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
      _ctx: RouterContext
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
  });

  // --- Basic completion ---

  it("completes immediately when runAgent returns no tool calls", async () => {
    const { ops, log } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([{ message: "Hello!", toolCalls: [] }]),
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
    expect(at(systemOps, 0).args[2]).toBe("You are a test assistant.");

    const humanOps = log.filter((l) => l.op === "appendHumanMessage");
    expect(humanOps).toHaveLength(1);
    expect(at(humanOps, 0).args[2]).toBe("What is 2+2?");
  });

  // --- Tool execution ---

  it("executes tool calls and completes on next turn", async () => {
    const { ops, log } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
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
    const resultConfig = at(toolResults, 0).args[1] as ToolResultConfig;
    expect(resultConfig.toolName).toBe("Echo");
    expect(resultConfig.content).toBe("Echo: hello");
  });

  // --- Multi-turn loop ---

  it("runs multiple turns with tool calls before completing", async () => {
    const { ops } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
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
      }))
    );

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
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
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([{ message: "done", toolCalls: [] }]),
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
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([]),
      threadOps: ops,
      buildContextMessage: () => "hi",
    });

    const stateManager = createAgentStateManager({
      initialState: {},
    });

    await expect(session.runSession({ stateManager })).rejects.toThrow(
      "No system prompt in state"
    );
  });

  it("skips system prompt when appendSystemPrompt is false", async () => {
    const { ops, log } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      appendSystemPrompt: false,
      runAgent: createScriptedRunAgent([{ message: "ok", toolCalls: [] }]),
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
      thread: { mode: "new", threadId: "thread-1" },
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
      thread: { mode: "new", threadId: "thread-1" },
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
      const config = l.args[1] as ToolResultConfig;
      return config.toolCallId === "tc-bad";
    });
    expect(errorResult).toBeDefined();
    const errorConfig = errorResult?.args[1] as ToolResultConfig | undefined;
    expect(errorConfig?.content).toContain("Invalid tool call");
  });

  // --- Thread fork mode ---

  it("forks thread when thread mode is fork", async () => {
    const { ops, log } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "fork", threadId: "source-thread" },
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
      createSandbox: async () => {
        sandboxLog.push("create");
        return { sandboxId: "sb-1" };
      },
      destroySandbox: async (sandboxId: string) => {
        sandboxLog.push(`destroy:${sandboxId}`);
      },
      snapshotSandbox: async () => ({
        sandboxId: "sb-1",
        providerId: "test",
        data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async () => "forked-sandbox-id",
      restoreSandbox: async () => "restored-sandbox-id",
      deleteSandboxSnapshot: async () => {},
      pauseSandbox: async () => {},
      resumeSandbox: async () => {},
    };

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([{ message: "done", toolCalls: [] }]),
      threadOps: ops,
      buildContextMessage: () => "go",
      sandboxOps,
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    expect(sandboxLog).toContain("create");
    expect(sandboxLog).toContain("destroy:sb-1");
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
      snapshotSandbox: async () => ({
        sandboxId: "sb-1",
        providerId: "test",
        data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async () => "forked-sandbox-id",
      restoreSandbox: async () => "restored-sandbox-id",
      deleteSandboxSnapshot: async () => {},
      pauseSandbox: async () => {},
      resumeSandbox: async () => {},
    };

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([{ message: "done", toolCalls: [] }]),
      threadOps: ops,
      buildContextMessage: () => "go",
      sandboxOps,
      sandbox: { mode: "inherit", sandboxId: "inherited-sb" },
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

    const sandboxOps: SandboxOps = {
      createSandbox: async () => ({ sandboxId: "sb" }),
      destroySandbox: async () => {},
      pauseSandbox: async () => {},
      resumeSandbox: async () => {},
      snapshotSandbox: async () => ({
        sandboxId: "sb",
        providerId: "test",
        data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async () => "forked-sb",
      restoreSandbox: async () => "restored-sb",
      deleteSandboxSnapshot: async () => {},
    };

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
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
      sandbox: { mode: "inherit", sandboxId: "my-sandbox" },
      sandboxOps,
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
      thread: { mode: "new", threadId: "thread-1" },
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
      "LLM went down"
    );

    expect(endReason).toBe("failed");
  });

  // --- Tool execution hooks within session ---

  it("fires global tool hooks during session tool processing", async () => {
    const { ops } = createMockThreadOps();
    const hookLog: string[] = [];

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
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
      runAgent: createScriptedRunAgent([{ message: "done", toolCalls: [] }]),
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
      thread: { mode: "new", threadId: "thread-1" },
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
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([{ message: "done", toolCalls: [] }]),
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
    expect(at(humanOps, 0).args[2]).toBe("async context");
  });

  // --- Skill resourceContents seeded as initialFiles ---

  it("passes skill resourceContents as initialFiles to createSandbox", async () => {
    const { ops } = createMockThreadOps();
    let capturedOptions: Record<string, unknown> | undefined;

    const sandboxOps: SandboxOps = {
      createSandbox: async (options) => {
        capturedOptions = options as Record<string, unknown>;
        return { sandboxId: "sb-skill" };
      },
      destroySandbox: async () => {},
      snapshotSandbox: async () => ({
        sandboxId: "sb-skill",
        providerId: "test",
        data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async () => "forked-sandbox-id",
      restoreSandbox: async () => "restored-sandbox-id",
      deleteSandboxSnapshot: async () => {},
      pauseSandbox: async () => {},
      resumeSandbox: async () => {},
    };

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([{ message: "done", toolCalls: [] }]),
      threadOps: ops,
      buildContextMessage: () => "go",
      sandboxOps,
      skills: [
        {
          name: "test-skill",
          description: "Test",
          instructions: "Do test",
          location: "/skills/test-skill",
          resourceContents: { "references/guide.md": "# Guide content" },
        },
      ],
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    expect(capturedOptions).toBeDefined();
    expect(capturedOptions?.initialFiles).toEqual({
      "/skills/test-skill/references/guide.md": "# Guide content",
    });
  });

  it("embeds skill resourceContents on synthetic file tree entries via inlineContent", async () => {
    const { ops } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([{ message: "done", toolCalls: [] }]),
      threadOps: ops,
      buildContextMessage: () => "go",
      virtualFs: { ctx: { projectId: "p" } },
      virtualFsOps: {
        resolveFileTree: async () => ({ fileTree: [] }),
      },
      skills: [
        {
          name: "test-skill",
          description: "Test",
          instructions: "Do test",
          location: "/skills/test-skill",
          resourceContents: {
            "references/alpha.md": "# Alpha doc",
            "references/beta.md": "# Beta doc",
          },
        },
      ],
      hooks: {
        onSessionStart: async () => {},
      },
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    const capturedFileTree = stateManager.getCurrentState().fileTree;
    expect(Array.isArray(capturedFileTree)).toBe(true);
    const entries = capturedFileTree as Array<{
      path: string;
      inlineContent?: string;
    }>;

    const alpha = entries.find(
      (e) => e.path === "/skills/test-skill/references/alpha.md"
    );
    const beta = entries.find(
      (e) => e.path === "/skills/test-skill/references/beta.md"
    );
    expect(alpha?.inlineContent).toBe("# Alpha doc");
    expect(beta?.inlineContent).toBe("# Beta doc");

    expect(stateManager.getCurrentState().inlineFiles).toEqual({
      "/skills/test-skill/references/alpha.md": "# Alpha doc",
      "/skills/test-skill/references/beta.md": "# Beta doc",
    });
  });

  it("does not pass initialFiles when skills have no resourceContents", async () => {
    const { ops } = createMockThreadOps();
    let capturedOptions: Record<string, unknown> | undefined;

    const sandboxOps: SandboxOps = {
      createSandbox: async (options) => {
        capturedOptions = options as Record<string, unknown>;
        return { sandboxId: "sb-no-rc" };
      },
      destroySandbox: async () => {},
      snapshotSandbox: async () => ({
        sandboxId: "sb-no-rc",
        providerId: "test",
        data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async () => "forked-sandbox-id",
      restoreSandbox: async () => "restored-sandbox-id",
      deleteSandboxSnapshot: async () => {},
      pauseSandbox: async () => {},
      resumeSandbox: async () => {},
    };

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([{ message: "done", toolCalls: [] }]),
      threadOps: ops,
      buildContextMessage: () => "go",
      sandboxOps,
      skills: [
        {
          name: "test-skill",
          description: "Test",
          instructions: "Do test",
        },
      ],
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    expect(capturedOptions).toBeUndefined();
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
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([
        {
          message: "t1",
          toolCalls: [{ id: "tc-1", name: "UsageTool", args: {} }],
          usage: { inputTokens: 100, outputTokens: 50 },
        },
        {
          message: "done",
          toolCalls: [],
          usage: { inputTokens: 80, outputTokens: 40 },
        },
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

  // --- Snapshot-driven shutdown ---

  it("captures base + exit snapshot and destroys sandbox on sandboxShutdown=snapshot", async () => {
    const { ops } = createMockThreadOps();
    const sandboxLog: string[] = [];
    let snapCounter = 0;

    const sandboxOps: SandboxOps = {
      createSandbox: async () => {
        sandboxLog.push("create");
        return { sandboxId: "sb-snap" };
      },
      destroySandbox: async (id: string) => {
        sandboxLog.push(`destroy:${id}`);
      },
      pauseSandbox: async () => {
        sandboxLog.push("pause");
      },
      resumeSandbox: async () => {},
      snapshotSandbox: async (id: string) => {
        snapCounter += 1;
        sandboxLog.push(`snapshot:${id}`);
        return {
          sandboxId: id,
          providerId: "test",
          data: { tag: `snap-${snapCounter}` },
          createdAt: new Date().toISOString(),
        };
      },
      restoreSandbox: async () => "restored-sb",
      deleteSandboxSnapshot: async () => {},
      forkSandbox: async () => "forked-sb",
    };

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-snap" },
      runAgent: createScriptedRunAgent([{ message: "done", toolCalls: [] }]),
      threadOps: ops,
      buildContextMessage: () => "go",
      sandboxOps,
      sandboxShutdown: "snapshot",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    const result = await session.runSession({ stateManager });

    expect(result.exitReason).toBe("completed");
    expect(result.sandboxId).toBe("sb-snap");
    expect(result.baseSnapshot?.data).toEqual({ tag: "snap-1" });
    expect(result.snapshot?.data).toEqual({ tag: "snap-2" });
    expect(sandboxLog).toEqual([
      "create",
      "snapshot:sb-snap",
      "snapshot:sb-snap",
      "destroy:sb-snap",
    ]);
    expect(sandboxLog).not.toContain("pause");
  });

  it("restores a sandbox when sandbox.mode=from-snapshot and skips base snapshot", async () => {
    const { ops } = createMockThreadOps();
    const sandboxLog: string[] = [];
    const priorSnapshot = {
      sandboxId: "sb-prior",
      providerId: "test",
      data: { tag: "prior" },
      createdAt: new Date().toISOString(),
    };

    const sandboxOps: SandboxOps = {
      createSandbox: async () => {
        sandboxLog.push("create");
        return { sandboxId: "sb-should-not-be-created" };
      },
      destroySandbox: async (id: string) => {
        sandboxLog.push(`destroy:${id}`);
      },
      pauseSandbox: async () => {},
      resumeSandbox: async () => {},
      snapshotSandbox: async (id: string) => {
        sandboxLog.push(`snapshot:${id}`);
        return {
          sandboxId: id,
          providerId: "test",
          data: { tag: "exit" },
          createdAt: new Date().toISOString(),
        };
      },
      restoreSandbox: async (snap) => {
        sandboxLog.push(`restore:${(snap.data as { tag: string }).tag}`);
        return "sb-restored";
      },
      deleteSandboxSnapshot: async () => {},
      forkSandbox: async () => "forked-sb",
    };

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-restore" },
      runAgent: createScriptedRunAgent([{ message: "done", toolCalls: [] }]),
      threadOps: ops,
      buildContextMessage: () => "go",
      sandboxOps,
      sandbox: { mode: "from-snapshot", snapshot: priorSnapshot },
      sandboxShutdown: "snapshot",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    const result = await session.runSession({ stateManager });

    expect(result.sandboxId).toBe("sb-restored");
    // No base snapshot because the sandbox was restored, not freshly created.
    expect(result.baseSnapshot).toBeUndefined();
    expect(result.snapshot?.data).toEqual({ tag: "exit" });
    expect(sandboxLog).toEqual([
      "restore:prior",
      "snapshot:sb-restored",
      "destroy:sb-restored",
    ]);
    expect(sandboxLog).not.toContain("create");
  });

  // --- Persistent thread state ---

  it("saves tasks + custom state to the thread store on session exit", async () => {
    const { ops, log, stateStore } = createMockThreadOps();

    const writeTasks = defineTool({
      name: "WriteTasks" as const,
      description: "create tasks via state manager",
      schema: z.object({}),
      handler: async (
        _args: Record<string, never>,
        _ctx: RouterContext
      ): Promise<ToolHandlerResponse<null>> => ({
        toolResponse: "ok",
        data: null,
      }),
    });

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-save" },
      runAgent: createScriptedRunAgent([
        {
          message: "doing work",
          toolCalls: [{ id: "tc-1", name: "WriteTasks", args: {} }],
        },
        { message: "done", toolCalls: [] },
      ]),
      threadOps: ops,
      tools: { WriteTasks: writeTasks },
      buildContextMessage: () => "go",
    });

    const stateManager = createAgentStateManager<{ note: string }>({
      initialState: { systemPrompt: "test", note: "hello" },
    });

    stateManager.setTask({
      id: "task-A",
      subject: "A",
      description: "A",
      activeForm: "doing A",
      status: "in_progress",
      metadata: { priority: "high" },
      blockedBy: [],
      blocks: [],
    });

    const result = await session.runSession({ stateManager });
    expect(result.exitReason).toBe("completed");

    const saves = log.filter((l) => l.op === "saveThreadState");
    expect(saves).toHaveLength(1);
    const saved = stateStore.get("thread-save");
    expect(saved).toBeDefined();
    expect(saved?.tasks).toHaveLength(1);
    if (saved) {
      expect(at(saved.tasks, 0)[0]).toBe("task-A");
    }
    expect(saved?.custom).toEqual({ note: "hello" });
  });

  it("rehydrates tasks + custom state on continue before the agent loop runs", async () => {
    const { ops, stateStore } = createMockThreadOps();

    stateStore.set("thread-cont", {
      tasks: [
        [
          "task-restored",
          {
            id: "task-restored",
            subject: "restored",
            description: "restored",
            activeForm: "restoring",
            status: "pending",
            metadata: {},
            blockedBy: [],
            blocks: [],
          },
        ],
      ],
      custom: { label: "from-prior-run" },
    });

    type State = { label: string };
    let observedTasksBeforeFirstTurn: string[] = [];
    let observedLabelBeforeFirstTurn: string | undefined;

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "continue", threadId: "thread-cont" },
      runAgent: async () => {
        observedTasksBeforeFirstTurn = stateManager.getTasks().map((t) => t.id);
        observedLabelBeforeFirstTurn = stateManager.get("label");
        return { message: "done", rawToolCalls: [], usage: undefined };
      },
      threadOps: ops,
      buildContextMessage: () => "continue please",
    });

    const stateManager = createAgentStateManager<State>({
      initialState: { systemPrompt: "test", label: "initial" },
    });

    await session.runSession({ stateManager });

    expect(observedTasksBeforeFirstTurn).toEqual(["task-restored"]);
    expect(observedLabelBeforeFirstTurn).toBe("from-prior-run");
  });

  it("fork copies the source thread's state slice into the new thread", async () => {
    const { ops, log, stateStore } = createMockThreadOps();

    stateStore.set("source-thread", {
      tasks: [
        [
          "task-src",
          {
            id: "task-src",
            subject: "src",
            description: "src",
            activeForm: "src",
            status: "completed",
            metadata: {},
            blockedBy: [],
            blocks: [],
          },
        ],
      ],
      custom: { counter: 3 },
    });

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "fork", threadId: "source-thread" },
      runAgent: createScriptedRunAgent([{ message: "done", toolCalls: [] }]),
      threadOps: ops,
      buildContextMessage: () => "continue",
    });

    type State = { counter: number };
    const stateManager = createAgentStateManager<State>({
      initialState: { systemPrompt: "test", counter: 0 },
    });

    const result = await session.runSession({ stateManager });
    expect(result.exitReason).toBe("completed");

    const forkOps = log.filter((l) => l.op === "forkThread");
    expect(forkOps).toHaveLength(1);
    expect(at(forkOps, 0).args[0]).toBe("source-thread");

    expect(stateManager.getTask("task-src")).toBeDefined();
    expect(stateManager.get("counter")).toBe(3);

    const newThreadSlice = stateStore.get(result.threadId);
    expect(newThreadSlice?.tasks).toHaveLength(1);
  });
});
