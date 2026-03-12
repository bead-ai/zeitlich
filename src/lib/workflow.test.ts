import { describe, expect, it } from "vitest";
import { defineWorkflow, type WorkflowSessionInput } from "./workflow";

describe("defineWorkflow", () => {
  it("maps previousThreadId to threadId + continueThread", async () => {
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow(async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { ok: true };
    });

    await workflow({ previousThreadId: "prev-42" });

    expect(capturedSession).toEqual({
      threadId: "prev-42",
      continueThread: true,
    });
  });

  it("maps sandboxId", async () => {
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow(async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { ok: true };
    });

    await workflow({ sandboxId: "sb-123" });

    expect(capturedSession).toEqual({ sandboxId: "sb-123" });
  });

  it("maps both previousThreadId and sandboxId together", async () => {
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow(async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { ok: true };
    });

    await workflow({ previousThreadId: "prev-1", sandboxId: "sb-1" });

    expect(capturedSession).toEqual({
      threadId: "prev-1",
      continueThread: true,
      sandboxId: "sb-1",
    });
  });

  it("returns empty sessionInput when no previousThreadId or sandboxId", async () => {
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow(async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { ok: true };
    });

    await workflow({});

    expect(capturedSession).toEqual({});
  });

  it("passes full input as first argument", async () => {
    let capturedInput: unknown;

    const workflow = defineWorkflow<{
      prompt: string;
      metadata: { key: string };
      previousThreadId?: string;
      sandboxId?: string;
    }, { ok: boolean }>(async (input, _sessionInput) => {
      capturedInput = input;
      return { ok: true };
    });

    await workflow({
      prompt: "research",
      metadata: { key: "val" },
      previousThreadId: "prev",
      sandboxId: "sb",
    });

    expect(capturedInput).toEqual({
      prompt: "research",
      metadata: { key: "val" },
      previousThreadId: "prev",
      sandboxId: "sb",
    });
  });

  it("returns the handler response unchanged", async () => {
    const workflow = defineWorkflow(async () => ({
      finalMessage: "result text",
      threadId: "thread-123",
    }));

    const result = await workflow({});

    expect(result).toEqual({
      finalMessage: "result text",
      threadId: "thread-123",
    });
  });
});
