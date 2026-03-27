import { describe, expect, it, vi, beforeEach } from "vitest";
import { z } from "zod";

let idCounter = 0;

vi.mock("@temporalio/workflow", () => {
  return {
    condition: async (fn: () => boolean) => fn(),
    defineUpdate: (name: string) => ({ __type: "update", name }),
    defineQuery: (name: string) => ({ __type: "query", name }),
    setHandler: (_def: unknown, _handler: unknown) => {},
    uuid4: () =>
      `00000000-0000-0000-0000-${String(++idCounter).padStart(12, "0")}`,
    log: { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  };
});

import { createAgentStateManager } from "./manager";
import type { WorkflowTask } from "../types";

describe("createAgentStateManager integration", () => {
  beforeEach(() => {
    idCounter = 0;
  });

  // --- Default initial state ---

  it("initializes with default values when no initialState given", () => {
    const sm = createAgentStateManager({});

    expect(sm.getStatus()).toBe("RUNNING");
    expect(sm.getTurns()).toBe(0);
    expect(sm.getVersion()).toBe(0);
    expect(sm.isRunning()).toBe(true);
    expect(sm.isTerminal()).toBe(false);
    expect(sm.getSystemPrompt()).toBeUndefined();
    expect(sm.getTasks()).toEqual([]);
    expect(sm.getTotalUsage()).toEqual({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedWriteTokens: 0,
      totalCachedReadTokens: 0,
      totalReasonTokens: 0,
      turns: 0,
    });
  });

  // --- Status transitions ---

  it("transitions through all status states and increments version", () => {
    const sm = createAgentStateManager({});

    expect(sm.getStatus()).toBe("RUNNING");
    expect(sm.getVersion()).toBe(0);

    sm.waitForInput();
    expect(sm.getStatus()).toBe("WAITING_FOR_INPUT");
    expect(sm.getVersion()).toBe(1);
    expect(sm.isRunning()).toBe(false);
    expect(sm.isTerminal()).toBe(false);

    sm.run();
    expect(sm.getStatus()).toBe("RUNNING");
    expect(sm.getVersion()).toBe(2);
    expect(sm.isRunning()).toBe(true);

    sm.complete();
    expect(sm.getStatus()).toBe("COMPLETED");
    expect(sm.isTerminal()).toBe(true);

    sm.fail();
    expect(sm.getStatus()).toBe("FAILED");
    expect(sm.isTerminal()).toBe(true);

    sm.cancel();
    expect(sm.getStatus()).toBe("CANCELLED");
    expect(sm.isTerminal()).toBe(true);
  });

  // --- Turns ---

  it("increments turns independently of version", () => {
    const sm = createAgentStateManager({});

    sm.incrementTurns();
    sm.incrementTurns();
    sm.incrementTurns();
    expect(sm.getTurns()).toBe(3);
    expect(sm.getVersion()).toBe(0);
  });

  // --- Custom state ---

  it("manages custom state via get/set with version increments", () => {
    const sm = createAgentStateManager<{ score: number; label: string }>({
      initialState: { systemPrompt: "test", score: 0, label: "init" },
    });

    expect(sm.get("score")).toBe(0);
    expect(sm.get("label")).toBe("init");

    sm.set("score", 42);
    expect(sm.get("score")).toBe(42);
    expect(sm.getVersion()).toBe(1);

    sm.set("label", "updated");
    expect(sm.get("label")).toBe("updated");
    expect(sm.getVersion()).toBe(2);
  });

  it("mergeUpdate bulk-updates custom state", () => {
    const sm = createAgentStateManager<{ a: string; b: number }>({
      initialState: { systemPrompt: "test", a: "old", b: 0 },
    });

    sm.mergeUpdate({ a: "new", b: 99 });
    expect(sm.get("a")).toBe("new");
    expect(sm.get("b")).toBe(99);
    expect(sm.getVersion()).toBe(1);
  });

  it("mergeUpdate with partial fields only updates provided keys", () => {
    const sm = createAgentStateManager<{ x: string; y: string }>({
      initialState: { systemPrompt: "test", x: "orig-x", y: "orig-y" },
    });

    sm.mergeUpdate({ x: "changed" });
    expect(sm.get("x")).toBe("changed");
    expect(sm.get("y")).toBe("orig-y");
  });

  // --- System prompt ---

  it("manages system prompt lifecycle", () => {
    const sm = createAgentStateManager({
      initialState: { systemPrompt: "initial prompt" },
    });

    expect(sm.getSystemPrompt()).toBe("initial prompt");

    sm.setSystemPrompt("updated prompt");
    expect(sm.getSystemPrompt()).toBe("updated prompt");
  });

  // --- Token usage accumulation ---

  it("accumulates token usage across multiple updates", () => {
    const sm = createAgentStateManager({});

    sm.updateUsage({ inputTokens: 100, outputTokens: 50 });
    sm.updateUsage({ inputTokens: 200, outputTokens: 100, cachedWriteTokens: 30 });
    sm.updateUsage({ cachedReadTokens: 20, reasonTokens: 10 });

    expect(sm.getTotalUsage()).toEqual({
      totalInputTokens: 300,
      totalOutputTokens: 150,
      totalCachedWriteTokens: 30,
      totalCachedReadTokens: 20,
      totalReasonTokens: 10,
      turns: 0,
    });
  });

  it("handles updateUsage with undefined fields gracefully", () => {
    const sm = createAgentStateManager({});

    sm.updateUsage({});
    sm.updateUsage({ inputTokens: undefined, outputTokens: undefined });

    expect(sm.getTotalUsage().totalInputTokens).toBe(0);
    expect(sm.getTotalUsage().totalOutputTokens).toBe(0);
  });

  // --- Task management ---

  it("CRUD operations on tasks", () => {
    const sm = createAgentStateManager({});

    const task: WorkflowTask = {
      id: "task-1",
      subject: "Test task",
      description: "A test task",
      activeForm: "Testing",
      status: "pending",
      metadata: {},
      blockedBy: [],
      blocks: [],
    };

    sm.setTask(task);
    expect(sm.getTasks()).toHaveLength(1);
    expect(sm.getTask("task-1")).toEqual(task);
    expect(sm.getVersion()).toBe(1);

    sm.setTask({ ...task, status: "in_progress" });
    expect(sm.getTask("task-1")?.status).toBe("in_progress");
    expect(sm.getVersion()).toBe(2);

    expect(sm.deleteTask("task-1")).toBe(true);
    expect(sm.getTasks()).toHaveLength(0);
    expect(sm.getTask("task-1")).toBeUndefined();
    expect(sm.getVersion()).toBe(3);
  });

  it("deleteTask returns false for nonexistent task and does not increment version", () => {
    const sm = createAgentStateManager({});

    expect(sm.deleteTask("nonexistent")).toBe(false);
    expect(sm.getVersion()).toBe(0);
  });

  it("manages multiple tasks simultaneously", () => {
    const sm = createAgentStateManager({});

    const makeTask = (id: string, subject: string): WorkflowTask => ({
      id,
      subject,
      description: "",
      activeForm: "",
      status: "pending",
      metadata: {},
      blockedBy: [],
      blocks: [],
    });

    sm.setTask(makeTask("t1", "Task 1"));
    sm.setTask(makeTask("t2", "Task 2"));
    sm.setTask(makeTask("t3", "Task 3"));

    expect(sm.getTasks()).toHaveLength(3);
    sm.deleteTask("t2");
    expect(sm.getTasks()).toHaveLength(2);
    expect(sm.getTask("t2")).toBeUndefined();
    expect(sm.getTask("t1")).toBeDefined();
    expect(sm.getTask("t3")).toBeDefined();
  });

  // --- getCurrentState ---

  it("getCurrentState returns a snapshot including custom state", () => {
    const sm = createAgentStateManager<{ mood: string }>({
      initialState: { systemPrompt: "test", mood: "happy", status: "RUNNING" },
    });

    sm.incrementTurns();
    sm.incrementTurns();

    const state = sm.getCurrentState();
    expect(state.status).toBe("RUNNING");
    expect(state.turns).toBe(2);
    expect(state.mood).toBe("happy");
  });

  // --- shouldReturnFromWait ---

  it("shouldReturnFromWait returns true when version advanced", () => {
    const sm = createAgentStateManager({});

    expect(sm.shouldReturnFromWait(0)).toBe(false);
    sm.incrementVersion();
    expect(sm.shouldReturnFromWait(0)).toBe(true);
    expect(sm.shouldReturnFromWait(1)).toBe(false);
  });

  it("shouldReturnFromWait returns true in terminal state regardless of version", () => {
    const sm = createAgentStateManager({});

    sm.complete();
    expect(sm.shouldReturnFromWait(999)).toBe(true);
  });

  // --- Initial state with pre-set tasks ---

  it("initializes with provided tasks map", () => {
    const tasks = new Map<string, WorkflowTask>([
      [
        "preloaded",
        {
          id: "preloaded",
          subject: "Preloaded task",
          description: "",
          activeForm: "",
          status: "completed",
          metadata: {},
          blockedBy: [],
          blocks: [],
        },
      ],
    ]);

    const sm = createAgentStateManager({
      initialState: { systemPrompt: "test", tasks },
    });

    expect(sm.getTasks()).toHaveLength(1);
    expect(sm.getTask("preloaded")?.status).toBe("completed");
  });

  // --- setTools ---

  it("setTools stores serializable tool definitions in state", () => {
    const sm = createAgentStateManager({});

    sm.setTools([
      {
        name: "TestTool",
        description: "A test tool",
        schema: z.object({ input: z.string() }),
      },
    ]);

    const state = sm.getCurrentState();
    expect(state.tools).toHaveLength(1);
    const firstTool = state.tools[0];
    if (!firstTool) throw new Error("expected tool");
    expect(firstTool.name).toBe("TestTool");
    expect(firstTool.description).toBe("A test tool");
    expect(firstTool.schema).toBeDefined();
    expect(typeof firstTool.schema).toBe("object");
  });

  // --- incrementVersion standalone ---

  it("incrementVersion works independently", () => {
    const sm = createAgentStateManager({});

    sm.incrementVersion();
    sm.incrementVersion();
    sm.incrementVersion();
    expect(sm.getVersion()).toBe(3);
    expect(sm.getStatus()).toBe("RUNNING");
  });

  // --- Usage turns are linked to incrementTurns ---

  it("getTotalUsage.turns reflects incrementTurns count", () => {
    const sm = createAgentStateManager({});

    sm.incrementTurns();
    sm.incrementTurns();
    expect(sm.getTotalUsage().turns).toBe(2);
  });
});
