import { describe, expect, it } from "vitest";
import {
  defineWorkflow,
  type WorkflowInput,
  type WorkflowSessionInput,
} from "./workflow";

const cfg = { name: "test-workflow" };

describe("defineWorkflow", () => {
  it("maps previousThreadId to threadId + continueThread", async () => {
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow(cfg, async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { ok: true };
    });

    await workflow({}, { previousThreadId: "prev-42" });

    expect(capturedSession).toEqual({
      agentName: "test-workflow",
      threadId: "prev-42",
      continueThread: true,
    });
  });

  it("maps sandboxId", async () => {
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow(cfg, async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { ok: true };
    });

    await workflow({}, { sandboxId: "sb-123" });

    expect(capturedSession).toEqual({
      agentName: "test-workflow",
      sandboxId: "sb-123",
    });
  });

  it("maps both previousThreadId and sandboxId together", async () => {
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow(cfg, async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { ok: true };
    });

    await workflow({}, { previousThreadId: "prev-1", sandboxId: "sb-1" });

    expect(capturedSession).toEqual({
      agentName: "test-workflow",
      threadId: "prev-1",
      continueThread: true,
      sandboxId: "sb-1",
    });
  });

  it("returns empty sessionInput when no previousThreadId or sandboxId", async () => {
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow(cfg, async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { ok: true };
    });

    await workflow({});

    expect(capturedSession).toEqual({ agentName: "test-workflow" });
  });

  it("passes full input as first argument", async () => {
    let capturedInput: unknown;

    const workflow = defineWorkflow<
      {
        prompt: string;
        metadata: { key: string };
        previousThreadId?: string;
        sandboxId?: string;
      },
      { ok: boolean }
    >(cfg, async (input, _sessionInput) => {
      capturedInput = input;
      return { ok: true };
    });

    await workflow({
      prompt: "research",
      metadata: { key: "val" },
    });

    expect(capturedInput).toEqual({
      prompt: "research",
      metadata: { key: "val" },
    });
  });

  it("passes workflowInput as second argument only", async () => {
    let capturedInput: unknown;
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow<{ prompt: string }, { ok: boolean }>(
      cfg,
      async (input, sessionInput) => {
        capturedInput = input;
        capturedSession = sessionInput;
        return { ok: true };
      }
    );

    const workflowInput: WorkflowInput = {
      previousThreadId: "prev",
      sandboxId: "sb",
    };
    await workflow({ prompt: "go" }, workflowInput);

    expect(capturedInput).toEqual({ prompt: "go" });
    expect(capturedSession).toEqual({
      agentName: "test-workflow",
      threadId: "prev",
      continueThread: true,
      sandboxId: "sb",
    });
  });

  it("returns the handler response unchanged", async () => {
    const workflow = defineWorkflow(cfg, async () => ({
      finalMessage: "result text",
      threadId: "thread-123",
    }));

    const result = await workflow({});

    expect(result).toEqual({
      finalMessage: "result text",
      threadId: "thread-123",
    });
  });

  it("sets the function name from config", () => {
    const workflow = defineWorkflow(
      { name: "my-main-workflow" },
      async () => ({})
    );

    expect(workflow.name).toBe("my-main-workflow");
  });

  it("maps previousSandboxId", async () => {
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow(cfg, async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { ok: true };
    });

    await workflow({}, { previousSandboxId: "sb-prev-1" });

    expect(capturedSession).toEqual({
      agentName: "test-workflow",
      previousSandboxId: "sb-prev-1",
    });
  });

  it("maps sandboxOnExit", async () => {
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow(cfg, async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { ok: true };
    });

    await workflow({}, { sandboxOnExit: "pause" });

    expect(capturedSession).toEqual({
      agentName: "test-workflow",
      sandboxOnExit: "pause",
    });
  });

  it("maps threadContinuationMode with previousThreadId", async () => {
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow(cfg, async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { ok: true };
    });

    await workflow(
      {},
      { previousThreadId: "prev-1", threadContinuationMode: "continue" }
    );

    expect(capturedSession).toEqual({
      agentName: "test-workflow",
      threadId: "prev-1",
      continueThread: true,
      threadContinuationMode: "continue",
    });
  });

  it("ignores threadContinuationMode without previousThreadId", async () => {
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow(cfg, async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { ok: true };
    });

    await workflow({}, { threadContinuationMode: "continue" });

    expect(capturedSession).toEqual({
      agentName: "test-workflow",
    });
  });

  it("maps sandboxContinuationMode with previousSandboxId", async () => {
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow(cfg, async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { ok: true };
    });

    await workflow(
      {},
      { previousSandboxId: "sb-1", sandboxContinuationMode: "continue" }
    );

    expect(capturedSession).toEqual({
      agentName: "test-workflow",
      previousSandboxId: "sb-1",
      sandboxContinuationMode: "continue",
    });
  });

  it("ignores sandboxContinuationMode without previousSandboxId", async () => {
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow(cfg, async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { ok: true };
    });

    await workflow({}, { sandboxContinuationMode: "continue" });

    expect(capturedSession).toEqual({
      agentName: "test-workflow",
    });
  });

  it("maps all fields together", async () => {
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow(cfg, async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { ok: true };
    });

    await workflow(
      {},
      {
        previousThreadId: "prev-t",
        threadContinuationMode: "continue",
        sandboxId: "sb-inherited",
        previousSandboxId: "sb-prev",
        sandboxContinuationMode: "fork",
        sandboxOnExit: "pause-until-parent-close",
      }
    );

    expect(capturedSession).toEqual({
      agentName: "test-workflow",
      threadId: "prev-t",
      continueThread: true,
      threadContinuationMode: "continue",
      sandboxId: "sb-inherited",
      previousSandboxId: "sb-prev",
      sandboxContinuationMode: "fork",
      sandboxOnExit: "pause-until-parent-close",
    });
  });

  it("defaults threadContinuationMode to fork when not specified", async () => {
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow(cfg, async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { ok: true };
    });

    await workflow({}, { previousThreadId: "prev-42" });

    expect(capturedSession).toEqual({
      agentName: "test-workflow",
      threadId: "prev-42",
      continueThread: true,
    });
    expect(capturedSession?.threadContinuationMode).toBeUndefined();
  });
});
