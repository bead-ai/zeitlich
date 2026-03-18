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
});
