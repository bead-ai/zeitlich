import { describe, expect, it } from "vitest";
import {
  defineWorkflow,
  type WorkflowInput,
  type WorkflowSessionInput,
} from "./workflow";

const cfg = { name: "test-workflow" };

describe("defineWorkflow", () => {
  it("maps thread fork into sessionInput", async () => {
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow(cfg, async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { ok: true };
    });

    await workflow({}, { thread: { mode: "fork", threadId: "prev-42" } });

    expect(capturedSession).toEqual({
      agentName: "test-workflow",
      sandboxShutdown: "destroy",
      thread: { mode: "fork", threadId: "prev-42" },
    });
  });

  it("maps sandbox inherit", async () => {
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow(cfg, async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { ok: true };
    });

    await workflow({}, { sandbox: { mode: "inherit", sandboxId: "sb-123" } });

    expect(capturedSession).toEqual({
      agentName: "test-workflow",
      sandboxShutdown: "destroy",
      sandbox: { mode: "inherit", sandboxId: "sb-123" },
    });
  });

  it("maps thread fork and sandbox together", async () => {
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow(cfg, async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { ok: true };
    });

    await workflow({}, {
      thread: { mode: "fork", threadId: "prev-1" },
      sandbox: { mode: "continue", sandboxId: "sb-1" },
    });

    expect(capturedSession).toEqual({
      agentName: "test-workflow",
      sandboxShutdown: "destroy",
      thread: { mode: "fork", threadId: "prev-1" },
      sandbox: { mode: "continue", sandboxId: "sb-1" },
    });
  });

  it("defaults sandboxShutdown to destroy when no workflowInput", async () => {
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow(cfg, async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { ok: true };
    });

    await workflow({});

    expect(capturedSession).toEqual({
      agentName: "test-workflow",
      sandboxShutdown: "destroy",
    });
  });

  it("maps sandbox fork from workflowInput", async () => {
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow(cfg, async (_input, sessionInput) => {
      capturedSession = sessionInput;
      return { ok: true };
    });

    await workflow({}, { sandbox: { mode: "fork", sandboxId: "prev-sb-1" } });

    expect(capturedSession).toEqual({
      agentName: "test-workflow",
      sandboxShutdown: "destroy",
      sandbox: { mode: "fork", sandboxId: "prev-sb-1" },
    });
  });

  it("uses sandboxShutdown from config", async () => {
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow(
      { name: "test-workflow", sandboxShutdown: "pause" },
      async (_input, sessionInput) => {
        capturedSession = sessionInput;
        return { ok: true };
      }
    );

    await workflow({});

    expect(capturedSession).toEqual({
      agentName: "test-workflow",
      sandboxShutdown: "pause",
    });
  });

  it("maps all lifecycle fields together", async () => {
    let capturedSession: WorkflowSessionInput | undefined;

    const workflow = defineWorkflow(
      { name: "test-workflow", sandboxShutdown: "pause" },
      async (_input, sessionInput) => {
        capturedSession = sessionInput;
        return { ok: true };
      }
    );

    await workflow(
      {},
      {
        thread: { mode: "fork", threadId: "prev-t" },
        sandbox: { mode: "fork", sandboxId: "prev-sb-1" },
      }
    );

    expect(capturedSession).toEqual({
      agentName: "test-workflow",
      sandboxShutdown: "pause",
      thread: { mode: "fork", threadId: "prev-t" },
      sandbox: { mode: "fork", sandboxId: "prev-sb-1" },
    });
  });

  it("passes full input as first argument", async () => {
    let capturedInput: unknown;

    const workflow = defineWorkflow<
      {
        prompt: string;
        metadata: { key: string };
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
      thread: { mode: "fork", threadId: "prev" },
      sandbox: { mode: "continue", sandboxId: "sb" },
    };
    await workflow({ prompt: "go" }, workflowInput);

    expect(capturedInput).toEqual({ prompt: "go" });
    expect(capturedSession).toEqual({
      agentName: "test-workflow",
      sandboxShutdown: "destroy",
      thread: { mode: "fork", threadId: "prev" },
      sandbox: { mode: "continue", sandboxId: "sb" },
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
