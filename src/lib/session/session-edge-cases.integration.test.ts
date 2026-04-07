import { describe, expect, it, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { ToolResultConfig, TokenUsage } from "../types";
import type { ThreadOps } from "./types";
import type { RunAgentActivity } from "../model/types";
import type { RawToolCall } from "../tool-router/types";
import type { SandboxOps } from "../sandbox/types";
import type { ActivityInterfaceFor } from "@temporalio/workflow";

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
    log: { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  };
});

import { createSession } from "./session";
import { createAgentStateManager } from "../state/manager";
import { defineTool } from "../tool-router/router";
import type { ToolHandlerResponse, RouterContext } from "../tool-router/types";

type TurnScript = {
  message: unknown;
  toolCalls: RawToolCall[];
  usage?: TokenUsage;
};

/**
 * Wraps every method on a ThreadOps object so it also has `.executeWithOptions()`,
 * matching Temporal's `ActivityInterfaceFor<ThreadOps>` shape.
 */
function toActivityInterface<TContent = string>(raw: ThreadOps<TContent>): ActivityInterfaceFor<ThreadOps<TContent>> {
  const result = {} as Record<string, unknown>;
  for (const [key, fn] of Object.entries(raw)) {
    const wrapped = (...args: unknown[]) =>
      (fn as (...a: unknown[]) => unknown)(...args);
    wrapped.executeWithOptions = (_opts: unknown, args: unknown[]) =>
      (fn as (...a: unknown[]) => unknown)(...args);
    result[key] = wrapped;
  }
  return result as ActivityInterfaceFor<ThreadOps<TContent>>;
}

function createMockThreadOps() {
  const log: { op: string; args: unknown[] }[] = [];
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
    },
  });
  return { ops, log };
}

function createScriptedRunAgent(
  turns: TurnScript[]
): RunAgentActivity<unknown> {
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
      _ctx: RouterContext
    ): Promise<ToolHandlerResponse<{ echoed: string }>> => ({
      toolResponse: `Echo: ${args.text}`,
      data: { echoed: args.text },
    }),
  });
}

describe("createSession edge cases", () => {
  beforeEach(() => {
    idCounter = 0;
  });

  // --- WAITING_FOR_INPUT flow (condition returns false = timeout) ---

  it("cancels session when WAITING_FOR_INPUT times out (condition returns false)", async () => {
    const { ops } = createMockThreadOps();
    let endReason: string | undefined;
    const capturedRef: {
      stateManager: ReturnType<typeof createAgentStateManager> | undefined;
    } = { stateManager: undefined };

    const waitTool = defineTool({
      name: "AskUser" as const,
      description: "asks user",
      schema: z.object({}),
      handler: async (_args: Record<string, never>, _ctx: RouterContext) => {
        capturedRef.stateManager?.waitForInput();
        return {
          toolResponse: "Please provide input.",
          data: null,
        };
      },
    });

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([
        {
          message: "Need user input",
          toolCalls: [{ id: "tc-1", name: "AskUser", args: {} }],
        },
      ]),
      threadOps: ops,
      tools: { AskUser: waitTool },
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
    capturedRef.stateManager = stateManager;

    const result = await session.runSession({ stateManager });

    expect(result.exitReason).toBe("cancelled");
    expect(result.finalMessage).toBeNull();
    expect(endReason).toBe("cancelled");
  });

  // --- All tool calls are invalid ---

  it("continues looping when all tool calls in a turn are invalid", async () => {
    const { ops, log } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([
        {
          message: "bad calls",
          toolCalls: [
            { id: "tc-1", name: "Nonexistent", args: {} },
            { id: "tc-2", name: "AlsoNonexistent", args: {} },
          ],
        },
        {
          message: "all done",
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
    expect(result.finalMessage).toBe("all done");

    const errorResults = log.filter((l) => {
      if (l.op !== "appendToolResult") return false;
      const config = l.args[1] as ToolResultConfig;
      return (
        typeof config.content === "string" &&
        config.content.includes("Invalid tool call")
      );
    });
    expect(errorResults).toHaveLength(2);
  });

  // --- Tool call with missing id ---

  it("handles tool call with missing id gracefully", async () => {
    const { ops, log } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([
        {
          message: "no id",
          toolCalls: [{ name: "Echo", args: { text: "hello" } }],
        },
        { message: "done", toolCalls: [] },
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
    expect(toolResults.length).toBeGreaterThan(0);
  });

  // --- No tools registered but rawToolCalls returned ---

  it("completes immediately when no tools are registered even if rawToolCalls are returned", async () => {
    const { ops } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([
        {
          message: "I tried calling a tool",
          toolCalls: [{ id: "tc-1", name: "Something", args: {} }],
        },
      ]),
      threadOps: ops,
      buildContextMessage: () => "go",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    const result = await session.runSession({ stateManager });

    expect(result.exitReason).toBe("completed");
    expect(result.finalMessage).toBe("I tried calling a tool");
    expect(result.usage.turns).toBe(1);
  });

  // --- Tool handler throws but session continues via failure hook ---

  it("session continues when tool handler throws and failure hook recovers", async () => {
    const { ops } = createMockThreadOps();

    const failTool = defineTool({
      name: "Fail" as const,
      description: "always fails",
      schema: z.object({}),
      handler: async (): Promise<ToolHandlerResponse<null>> => {
        throw new Error("tool exploded");
      },
    });

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([
        {
          message: "calling fail",
          toolCalls: [{ id: "tc-1", name: "Fail", args: {} }],
        },
        { message: "recovered", toolCalls: [] },
      ]),
      threadOps: ops,
      tools: { Fail: failTool },
      buildContextMessage: () => "go",
      hooks: {
        onPostToolUseFailure: async () => ({
          fallbackContent: "Tool failed, but recovered",
        }),
      },
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    const result = await session.runSession({ stateManager });

    expect(result.exitReason).toBe("completed");
    expect(result.finalMessage).toBe("recovered");
  });

  // --- Tool handler throws without recovery ---

  it("session completes when tool handler throws with no failure hook (error suppressed)", async () => {
    const { ops } = createMockThreadOps();
    let endReason: string | undefined;

    const failTool = defineTool({
      name: "Fail" as const,
      description: "always fails",
      schema: z.object({}),
      handler: async (): Promise<ToolHandlerResponse<null>> => {
        throw new Error("unrecoverable tool");
      },
    });

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([
        {
          message: "calling fail",
          toolCalls: [{ id: "tc-1", name: "Fail", args: {} }],
        },
      ]),
      threadOps: ops,
      tools: { Fail: failTool },
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

    const result = await session.runSession({ stateManager });
    expect(result.exitReason).toBe("completed");
    expect(result.finalMessage).toBe("done");
    expect(endReason).toBe("completed");
  });

  // --- Metadata passed through to hooks ---

  it("passes metadata to session hooks", async () => {
    const { ops } = createMockThreadOps();
    let capturedStartMeta: Record<string, unknown> | undefined;
    let capturedEndMeta: Record<string, unknown> | undefined;

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      metadata: { env: "test", version: 42 },
      runAgent: createScriptedRunAgent([{ message: "done", toolCalls: [] }]),
      threadOps: ops,
      buildContextMessage: () => "go",
      hooks: {
        onSessionStart: async ({ metadata }) => {
          capturedStartMeta = metadata;
        },
        onSessionEnd: async ({ metadata }) => {
          capturedEndMeta = metadata;
        },
      },
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    expect(capturedStartMeta).toEqual({ env: "test", version: 42 });
    expect(capturedEndMeta).toEqual({ env: "test", version: 42 });
  });

  // --- Sandbox error during create ---

  it("propagates sandbox creation error", async () => {
    const { ops } = createMockThreadOps();

    const sandboxOps: SandboxOps = {
      createSandbox: async () => {
        throw new Error("sandbox creation failed");
      },
      destroySandbox: async () => {},
      snapshotSandbox: async () => ({
        sandboxId: "sb-1",
        providerId: "test",
        data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async () => "forked-sandbox-id",
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

    await expect(session.runSession({ stateManager })).rejects.toThrow(
      "sandbox creation failed"
    );
  });

  // --- Sandbox is destroyed even after session error ---

  it("destroys sandbox in finally block even when session fails", async () => {
    const { ops } = createMockThreadOps();
    const sandboxLog: string[] = [];

    const sandboxOps: SandboxOps = {
      createSandbox: async () => {
        sandboxLog.push("create");
        return { sandboxId: "sb-cleanup" };
      },
      destroySandbox: async (id: string) => {
        sandboxLog.push(`destroy:${id}`);
      },
      snapshotSandbox: async () => ({
        sandboxId: "sb-1",
        providerId: "test",
        data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async () => "forked-sandbox-id",
      pauseSandbox: async () => {},
      resumeSandbox: async () => {},
    };

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: async () => {
        throw new Error("LLM crash");
      },
      threadOps: ops,
      buildContextMessage: () => "go",
      sandboxOps,
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await expect(session.runSession({ stateManager })).rejects.toThrow(
      "LLM crash"
    );

    expect(sandboxLog).toContain("create");
    expect(sandboxLog).toContain("destroy:sb-cleanup");
  });

  // --- Empty system prompt (whitespace only) ---

  it("throws when system prompt is whitespace-only", async () => {
    const { ops } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([]),
      threadOps: ops,
      buildContextMessage: () => "hi",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "   " },
    });

    await expect(session.runSession({ stateManager })).rejects.toThrow(
      "No system prompt in state"
    );
  });

  // --- Tool that returns usage ---

  it("accumulates usage from both runAgent and tool handler results", async () => {
    const { ops } = createMockThreadOps();

    const usageTool = defineTool({
      name: "SubAgent" as const,
      description: "returns usage",
      schema: z.object({}),
      handler: async () => ({
        toolResponse: "ok",
        data: null,
        usage: { inputTokens: 200, outputTokens: 100 },
      }),
    });

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([
        {
          message: "t1",
          toolCalls: [
            { id: "tc-1", name: "SubAgent", args: {} },
            { id: "tc-2", name: "SubAgent", args: {} },
          ],
          usage: { inputTokens: 50, outputTokens: 25 },
        },
        {
          message: "done",
          toolCalls: [],
          usage: { inputTokens: 50, outputTokens: 25 },
        },
      ]),
      threadOps: ops,
      tools: { SubAgent: usageTool },
      buildContextMessage: () => "go",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    const result = await session.runSession({ stateManager });

    expect(result.usage.totalInputTokens).toBe(100);
    expect(result.usage.totalOutputTokens).toBe(50);
  });

  // --- Thread fork: new threadId from source ---

  it("fork thread mode generates new threadId and forks when source is provided", async () => {
    const { ops, log } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "fork", threadId: "original-thread" },
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
    expect(result.threadId).not.toBe("original-thread");

    const forkOps = log.filter((l) => l.op === "forkThread");
    expect(forkOps).toHaveLength(1);
    const forkOp = forkOps[0];
    if (!forkOp) throw new Error("expected fork op");
    expect(forkOp.args[0]).toBe("original-thread");
  });

  // --- maxTurns of 1 ---

  it("stops after exactly 1 turn when maxTurns is 1", async () => {
    const { ops } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      maxTurns: 1,
      runAgent: createScriptedRunAgent([
        {
          message: "turn 1",
          toolCalls: [{ id: "tc-1", name: "Echo", args: { text: "hi" } }],
        },
        { message: "turn 2", toolCalls: [] },
      ]),
      threadOps: ops,
      tools: { Echo: createEchoTool() },
      buildContextMessage: () => "go",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    const result = await session.runSession({ stateManager });

    expect(result.exitReason).toBe("max_turns");
    expect(result.finalMessage).toBeNull();
    expect(result.usage.turns).toBe(1);
  });

  // --- processToolsInParallel false ---

  it("processes tools sequentially when processToolsInParallel is false", async () => {
    const { ops } = createMockThreadOps();
    const order: string[] = [];

    const slowTool = defineTool({
      name: "Slow" as const,
      description: "slow",
      schema: z.object({ id: z.string() }),
      handler: async (args: { id: string }) => {
        order.push(`start-${args.id}`);
        await new Promise((r) => setTimeout(r, 10));
        order.push(`end-${args.id}`);
        return { toolResponse: "ok", data: null };
      },
    });

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      processToolsInParallel: false,
      runAgent: createScriptedRunAgent([
        {
          message: "two calls",
          toolCalls: [
            { id: "tc-1", name: "Slow", args: { id: "a" } },
            { id: "tc-2", name: "Slow", args: { id: "b" } },
          ],
        },
        { message: "done", toolCalls: [] },
      ]),
      threadOps: ops,
      tools: { Slow: slowTool },
      buildContextMessage: () => "go",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    expect(order).toEqual(["start-a", "end-a", "start-b", "end-b"]);
  });

  // --- Mix of valid and unknown tool calls in single turn ---

  it("processes valid tool calls even when some are unknown in same turn", async () => {
    const { ops, log } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([
        {
          message: "mixed",
          toolCalls: [
            { id: "tc-1", name: "Echo", args: { text: "valid" } },
            { id: "tc-2", name: "Unknown", args: {} },
          ],
        },
        { message: "done", toolCalls: [] },
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
    const echoResult = toolResults.find((l) => {
      const config = l.args[1] as ToolResultConfig;
      return config.toolName === "Echo";
    });
    expect(echoResult).toBeDefined();
    if (echoResult) {
      expect((echoResult.args[1] as ToolResultConfig).content).toBe(
        "Echo: valid"
      );
    }

    const unknownResult = toolResults.find((l) => {
      const config = l.args[1] as ToolResultConfig;
      return config.toolName === "Unknown";
    });
    expect(unknownResult).toBeDefined();
    const unknownContent = unknownResult
      ? (unknownResult.args[1] as ToolResultConfig).content
      : undefined;
    expect(
      typeof unknownContent === "string" &&
        unknownContent.includes("Invalid tool call")
    ).toBe(true);
  });

  // --- buildContextMessage returns SDK-native content (non-string) ---

  it("handles buildContextMessage returning SDK-native content array", async () => {
    type TestContent = string | { type: string; [key: string]: unknown }[];
    const log: { op: string; args: unknown[] }[] = [];
    const ops = toActivityInterface<TestContent>({
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
      },
    });

    const session = await createSession<Record<string, never>, unknown, TestContent>({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([{ message: "done", toolCalls: [] }]),
      threadOps: ops,
      buildContextMessage: () => [
        { type: "text", text: "Hello" },
        { type: "image_url", url: "https://example.com/img.png" },
      ],
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    const humanOps = log.filter((l) => l.op === "appendHumanMessage");
    expect(humanOps).toHaveLength(1);
    const humanOp = humanOps[0];
    if (!humanOp) throw new Error("expected human op");
    const content = humanOp.args[2];
    expect(Array.isArray(content)).toBe(true);
    const firstContent = (content as { type: string }[])[0];
    if (!firstContent) throw new Error("expected content item");
    expect(firstContent.type).toBe("text");
  });

  // --- onSessionEnd always called (even on success) ---

  it("onSessionEnd receives correct turns count", async () => {
    const { ops } = createMockThreadOps();
    let endTurns: number | undefined;

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([
        {
          message: "t1",
          toolCalls: [{ id: "tc-1", name: "Echo", args: { text: "a" } }],
        },
        {
          message: "t2",
          toolCalls: [{ id: "tc-2", name: "Echo", args: { text: "b" } }],
        },
        { message: "final", toolCalls: [] },
      ]),
      threadOps: ops,
      tools: { Echo: createEchoTool() },
      buildContextMessage: () => "go",
      hooks: {
        onSessionEnd: async ({ turns }) => {
          endTurns = turns;
        },
      },
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    expect(endTurns).toBe(3);
  });

  // --- Tool handler returns resultAppended: true ---

  it("skips appendToolResult when handler sets resultAppended", async () => {
    const { ops, log } = createMockThreadOps();

    const selfAppendTool = defineTool({
      name: "SelfAppend" as const,
      description: "appends itself",
      schema: z.object({}),
      handler: async () => ({
        toolResponse: "self-managed",
        data: null,
        resultAppended: true,
      }),
    });

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([
        {
          message: "self",
          toolCalls: [{ id: "tc-1", name: "SelfAppend", args: {} }],
        },
        { message: "done", toolCalls: [] },
      ]),
      threadOps: ops,
      tools: { SelfAppend: selfAppendTool },
      buildContextMessage: () => "go",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    const toolResults = log.filter((l) => {
      if (l.op !== "appendToolResult") return false;
      const config = l.args[1] as ToolResultConfig;
      return config.toolName === "SelfAppend";
    });
    expect(toolResults).toHaveLength(0);
  });

  // --- Pre-hook skips tool in session context ---

  it("pre-hook skip works within full session flow", async () => {
    const { ops, log } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([
        {
          message: "calling",
          toolCalls: [{ id: "tc-1", name: "Echo", args: { text: "skip-me" } }],
        },
        { message: "done", toolCalls: [] },
      ]),
      threadOps: ops,
      tools: { Echo: createEchoTool() },
      buildContextMessage: () => "go",
      hooks: {
        onPreToolUse: async ({ toolCall }) => {
          if (
            toolCall.args &&
            (toolCall.args as { text: string }).text === "skip-me"
          ) {
            return { skip: true };
          }
          return {};
        },
      },
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    const toolResults = log.filter((l) => l.op === "appendToolResult");
    expect(toolResults).toHaveLength(1);
    const toolResult = toolResults[0];
    if (!toolResult) throw new Error("expected tool result");
    const content = (toolResult.args[1] as ToolResultConfig).content;
    expect(typeof content === "string" && content.includes("Skipped")).toBe(
      true
    );
  });

  // --- Sandbox snapshot is not called on normal flow ---

  it("sandbox snapshotSandbox is not called during normal session lifecycle", async () => {
    const { ops } = createMockThreadOps();
    const snapshotSpy = vi.fn(async () => ({
      sandboxId: "sb-1",
      providerId: "test",
      data: null,
      createdAt: new Date().toISOString(),
    }));

    const sandboxOps: SandboxOps = {
      createSandbox: async () => ({ sandboxId: "sb-test" }),
      destroySandbox: async () => {},
      snapshotSandbox: snapshotSpy,
      forkSandbox: async () => "forked-sandbox-id",
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

    expect(snapshotSpy).not.toHaveBeenCalled();
  });

  // --- Thread operations order ---

  it("calls thread operations in correct order: system → human → [loop]", async () => {
    const { ops, log } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([
        {
          message: "t1",
          toolCalls: [{ id: "tc-1", name: "Echo", args: { text: "a" } }],
        },
        { message: "done", toolCalls: [] },
      ]),
      threadOps: ops,
      tools: { Echo: createEchoTool() },
      buildContextMessage: () => "context message",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "System prompt here" },
    });

    await session.runSession({ stateManager });

    const opNames = log.map((l) => l.op);
    const systemIdx = opNames.indexOf("appendSystemMessage");
    const humanIdx = opNames.indexOf("appendHumanMessage");
    const toolResultIdx = opNames.indexOf("appendToolResult");

    expect(systemIdx).toBeLessThan(humanIdx);
    expect(humanIdx).toBeLessThan(toolResultIdx);
  });

  // --- maxTurns = 0 exits immediately ---

  it("exits with max_turns when maxTurns is 0", async () => {
    const { ops } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      maxTurns: 0,
      runAgent: createScriptedRunAgent([]),
      threadOps: ops,
      tools: { Echo: createEchoTool() },
      buildContextMessage: () => "go",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    const result = await session.runSession({ stateManager });

    expect(result.exitReason).toBe("max_turns");
    expect(result.usage.turns).toBe(0);
    expect(result.finalMessage).toBeNull();
  });

  // --- sandboxId returned from runSession ---

  it("returns sandboxId from runSession when sandbox is created", async () => {
    const { ops } = createMockThreadOps();

    const sandboxOps: SandboxOps = {
      createSandbox: async () => ({ sandboxId: "sb-created" }),
      destroySandbox: async () => {},
      pauseSandbox: async () => {},
      resumeSandbox: async () => {},
      snapshotSandbox: async () => ({
        sandboxId: "sb-1",
        providerId: "test",
        data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async () => "forked-sb",
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

    const result = await session.runSession({ stateManager });
    expect((result as { sandboxId?: string }).sandboxId).toBe("sb-created");
  });

  it("returns inherited sandboxId from runSession", async () => {
    const { ops } = createMockThreadOps();

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
    };

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([{ message: "done", toolCalls: [] }]),
      threadOps: ops,
      buildContextMessage: () => "go",
      sandbox: { mode: "inherit", sandboxId: "inherited-sb" },
      sandboxOps,
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    const result = await session.runSession({ stateManager });
    expect((result as { sandboxId?: string }).sandboxId).toBe("inherited-sb");
  });

  // --- Inherited sandbox is not destroyed ---

  it("does not destroy inherited sandbox even when sandboxOps is provided", async () => {
    const { ops } = createMockThreadOps();
    const sandboxLog: string[] = [];

    const sandboxOps: SandboxOps = {
      createSandbox: async () => {
        sandboxLog.push("create");
        return { sandboxId: "new-sb" };
      },
      destroySandbox: async (id: string) => {
        sandboxLog.push(`destroy:${id}`);
      },
      pauseSandbox: async (id: string) => {
        sandboxLog.push(`pause:${id}`);
      },
      resumeSandbox: async () => {},
      snapshotSandbox: async () => ({
        sandboxId: "sb-1",
        providerId: "test",
        data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async () => "forked-sb",
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

  // --- Sandbox fork ---

  it("forks sandbox when sandbox init mode is fork", async () => {
    const { ops } = createMockThreadOps();
    const sandboxLog: string[] = [];

    const sandboxOps: SandboxOps = {
      createSandbox: async () => {
        sandboxLog.push("create");
        return { sandboxId: "new-sb" };
      },
      destroySandbox: async (id: string) => {
        sandboxLog.push(`destroy:${id}`);
      },
      pauseSandbox: async () => {},
      resumeSandbox: async () => {},
      snapshotSandbox: async () => ({
        sandboxId: "sb-1",
        providerId: "test",
        data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async (id: string) => {
        sandboxLog.push(`fork:${id}`);
        return `forked-from-${id}`;
      },
    };

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([{ message: "done", toolCalls: [] }]),
      threadOps: ops,
      buildContextMessage: () => "go",
      sandboxOps,
      sandbox: { mode: "fork", sandboxId: "paused-sb-1" },
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    const result = await session.runSession({ stateManager });

    expect(sandboxLog).toContain("fork:paused-sb-1");
    expect(sandboxLog).not.toContain("create");
    expect((result as { sandboxId?: string }).sandboxId).toBe("forked-from-paused-sb-1");
    expect(sandboxLog).toContain("destroy:forked-from-paused-sb-1");
  });

  // --- Forked sandbox is destroyed on exit ---

  it("destroys forked sandbox on exit (not inherited)", async () => {
    const { ops } = createMockThreadOps();
    const sandboxLog: string[] = [];

    const sandboxOps: SandboxOps = {
      createSandbox: async () => ({ sandboxId: "new-sb" }),
      destroySandbox: async (id: string) => {
        sandboxLog.push(`destroy:${id}`);
      },
      pauseSandbox: async () => {},
      resumeSandbox: async () => {},
      snapshotSandbox: async () => ({
        sandboxId: "sb-1",
        providerId: "test",
        data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async () => "forked-sb",
    };

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([{ message: "done", toolCalls: [] }]),
      threadOps: ops,
      buildContextMessage: () => "go",
      sandboxOps,
      sandbox: { mode: "fork", sandboxId: "old-sb" },
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    expect(sandboxLog).toContain("destroy:forked-sb");
  });

  // --- sandboxShutdown: "pause" ---

  it("pauses sandbox on exit when sandboxShutdown is pause", async () => {
    const { ops } = createMockThreadOps();
    const sandboxLog: string[] = [];

    const sandboxOps: SandboxOps = {
      createSandbox: async () => ({ sandboxId: "sb-pause-test" }),
      destroySandbox: async (id: string) => {
        sandboxLog.push(`destroy:${id}`);
      },
      pauseSandbox: async (id: string) => {
        sandboxLog.push(`pause:${id}`);
      },
      resumeSandbox: async () => {},
      snapshotSandbox: async () => ({
        sandboxId: "sb-1",
        providerId: "test",
        data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async () => "forked-sb",
    };

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([{ message: "done", toolCalls: [] }]),
      threadOps: ops,
      buildContextMessage: () => "go",
      sandboxOps,
      sandboxShutdown: "pause",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    expect(sandboxLog).toContain("pause:sb-pause-test");
    expect(sandboxLog).not.toContain("destroy:sb-pause-test");
  });

  // --- sandboxShutdown: "pause-until-parent-close" ---

  it("pauses sandbox on exit when sandboxShutdown is pause-until-parent-close", async () => {
    const { ops } = createMockThreadOps();
    const sandboxLog: string[] = [];

    const sandboxOps: SandboxOps = {
      createSandbox: async () => ({ sandboxId: "sb-parent-close" }),
      destroySandbox: async (id: string) => {
        sandboxLog.push(`destroy:${id}`);
      },
      pauseSandbox: async (id: string) => {
        sandboxLog.push(`pause:${id}`);
      },
      resumeSandbox: async () => {},
      snapshotSandbox: async () => ({
        sandboxId: "sb-1",
        providerId: "test",
        data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async () => "forked-sb",
    };

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([{ message: "done", toolCalls: [] }]),
      threadOps: ops,
      buildContextMessage: () => "go",
      sandboxOps,
      sandboxShutdown: "pause-until-parent-close",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    expect(sandboxLog).toContain("pause:sb-parent-close");
    expect(sandboxLog).not.toContain("destroy:sb-parent-close");
  });

  // --- Throws when sandbox fork/continue provided without sandboxOps ---

  it("throws when sandbox fork mode is set without sandboxOps", async () => {
    const { ops } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([{ message: "done", toolCalls: [] }]),
      threadOps: ops,
      buildContextMessage: () => "go",
      sandbox: { mode: "fork", sandboxId: "prev-sb" },
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await expect(session.runSession({ stateManager })).rejects.toThrow(
      "No sandboxOps provided — cannot fork sandbox"
    );
  });

  // --- No sandboxId returned when no sandbox ---

  it("does not return sandboxId when no sandbox is configured", async () => {
    const { ops } = createMockThreadOps();

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([{ message: "done", toolCalls: [] }]),
      threadOps: ops,
      buildContextMessage: () => "go",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    const result = await session.runSession({ stateManager });
    expect((result as { sandboxId?: string }).sandboxId).toBeUndefined();
  });

  // --- Thread: defaults to new thread when no thread field provided ---

  it("defaults to new thread without fork when no thread field is provided", async () => {
    const { ops, log } = createMockThreadOps();

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
    expect(result.exitReason).toBe("completed");

    const forkOps = log.filter((l) => l.op === "forkThread");
    expect(forkOps).toHaveLength(0);

    const systemOps = log.filter((l) => l.op === "appendSystemMessage");
    expect(systemOps).toHaveLength(1);
  });

  // --- Sandbox pause on error ---

  it("pauses sandbox even when session fails if sandboxShutdown is pause", async () => {
    const { ops } = createMockThreadOps();
    const sandboxLog: string[] = [];

    const sandboxOps: SandboxOps = {
      createSandbox: async () => ({ sandboxId: "sb-err" }),
      destroySandbox: async (id: string) => {
        sandboxLog.push(`destroy:${id}`);
      },
      pauseSandbox: async (id: string) => {
        sandboxLog.push(`pause:${id}`);
      },
      resumeSandbox: async () => {},
      snapshotSandbox: async () => ({
        sandboxId: "sb-1",
        providerId: "test",
        data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async () => "forked-sb",
    };

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: async () => {
        throw new Error("crash");
      },
      threadOps: ops,
      buildContextMessage: () => "go",
      sandboxOps,
      sandboxShutdown: "pause",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await expect(session.runSession({ stateManager })).rejects.toThrow(
      "crash"
    );

    expect(sandboxLog).toContain("pause:sb-err");
    expect(sandboxLog).not.toContain("destroy:sb-err");
  });

  // --- sandboxShutdown: "keep-until-parent-close" ---

  it("keeps sandbox running on exit when sandboxShutdown is keep-until-parent-close", async () => {
    const { ops } = createMockThreadOps();
    const sandboxLog: string[] = [];

    const sandboxOps: SandboxOps = {
      createSandbox: async () => ({ sandboxId: "sb-keep-parent" }),
      destroySandbox: async (id: string) => {
        sandboxLog.push(`destroy:${id}`);
      },
      pauseSandbox: async (id: string) => {
        sandboxLog.push(`pause:${id}`);
      },
      resumeSandbox: async () => {},
      snapshotSandbox: async () => ({
        sandboxId: "sb-1",
        providerId: "test",
        data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async () => "forked-sb",
    };

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([{ message: "done", toolCalls: [] }]),
      threadOps: ops,
      buildContextMessage: () => "go",
      sandboxOps,
      sandboxShutdown: "keep-until-parent-close",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    expect(sandboxLog).not.toContain("pause:sb-keep-parent");
    expect(sandboxLog).not.toContain("destroy:sb-keep-parent");
  });

  it("keeps sandbox running on error when sandboxShutdown is keep-until-parent-close", async () => {
    const { ops } = createMockThreadOps();
    const sandboxLog: string[] = [];

    const sandboxOps: SandboxOps = {
      createSandbox: async () => ({ sandboxId: "sb-keep-err" }),
      destroySandbox: async (id: string) => {
        sandboxLog.push(`destroy:${id}`);
      },
      pauseSandbox: async (id: string) => {
        sandboxLog.push(`pause:${id}`);
      },
      resumeSandbox: async () => {},
      snapshotSandbox: async () => ({
        sandboxId: "sb-1",
        providerId: "test",
        data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async () => "forked-sb",
    };

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: async () => {
        throw new Error("crash");
      },
      threadOps: ops,
      buildContextMessage: () => "go",
      sandboxOps,
      sandboxShutdown: "keep-until-parent-close",
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await expect(session.runSession({ stateManager })).rejects.toThrow(
      "crash"
    );

    expect(sandboxLog).not.toContain("pause:sb-keep-err");
    expect(sandboxLog).not.toContain("destroy:sb-keep-err");
  });

  // --- sandbox continue calls resumeSandbox ---

  it("calls resumeSandbox when sandbox mode is continue", async () => {
    const { ops } = createMockThreadOps();
    const sandboxLog: string[] = [];

    const sandboxOps: SandboxOps = {
      createSandbox: async () => ({ sandboxId: "new-sb" }),
      destroySandbox: async (id: string) => {
        sandboxLog.push(`destroy:${id}`);
      },
      pauseSandbox: async () => {},
      resumeSandbox: async (id: string) => {
        sandboxLog.push(`resume:${id}`);
      },
      snapshotSandbox: async () => ({
        sandboxId: "sb-1",
        providerId: "test",
        data: null,
        createdAt: new Date().toISOString(),
      }),
      forkSandbox: async () => "forked-sb",
    };

    const session = await createSession({
      agentName: "TestAgent",
      thread: { mode: "new", threadId: "thread-1" },
      runAgent: createScriptedRunAgent([{ message: "done", toolCalls: [] }]),
      threadOps: ops,
      buildContextMessage: () => "go",
      sandboxOps,
      sandbox: { mode: "continue", sandboxId: "paused-sb" },
    });

    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "test" },
    });

    await session.runSession({ stateManager });

    expect(sandboxLog).toContain("resume:paused-sb");
    expect(sandboxLog).toContain("destroy:paused-sb");
  });
});
