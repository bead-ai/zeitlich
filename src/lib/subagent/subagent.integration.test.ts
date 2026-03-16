import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@temporalio/workflow", () => {
  let counter = 0;
  return {
    workflowInfo: () => ({ taskQueue: "default-queue" }),
    executeChild: vi.fn(
      async (_workflow: unknown, opts: { args: unknown[] }) => {
        const prompt = (opts.args as [string])[0];
        return {
          toolResponse: `Response to: ${prompt}`,
          data: { result: "child-data" },
          threadId: "child-thread-1",
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      }
    ),
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
  SubagentWorkflowInput,
} from "./types";

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
      "createSubagentTool requires at least one subagent"
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
      { threadId: "parent-thread", toolCallId: "tc-1", toolName: "Subagent" }
    );

    expect(result.toolResponse).toContain("Response to: Find info");
    expect(result.data).toEqual({ result: "child-data" });
  });

  it("throws for unknown subagent name", async () => {
    const handler = createSubagentHandler([basicSubagent]);

    await expect(
      handler(
        { subagent: "nonexistent", description: "test", prompt: "test" },
        { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
      )
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
        { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
      )
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
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
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
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
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
      { threadId: "t", toolCallId: "tc", toolName: "Subagent" }
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
      {
        threadId: "t",
        toolCallId: "tc",
        toolName: "Subagent",
        sandboxId: "parent-sb",
      }
    );

    const lastCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected exec call");
    const workflowInput = lastCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.sandboxId).toBe("parent-sb");
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
      {
        threadId: "t",
        toolCallId: "tc",
        toolName: "Subagent",
        sandboxId: "parent-sb",
      }
    );

    const lastCall = execMock.mock.calls[execMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected exec call");
    const workflowInput = lastCall[1].args[1] as SubagentWorkflowInput;
    expect(workflowInput.sandboxId).toBeUndefined();
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

  it("enabled function is re-evaluated dynamically", () => {
    let flag = true;
    const reg = buildSubagentRegistration([
      {
        agentName: "toggle",
        description: "Toggleable",
        workflow: "workflow",
        enabled: () => flag,
      },
    ]);

    expect(reg).toBeDefined();
    if (!reg) return;
    expect((reg.enabled as () => boolean)()).toBe(true);

    flag = false;
    expect((reg.enabled as () => boolean)()).toBe(false);
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
      expect((reg.enabled as () => boolean)()).toBe(false);
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

  it("dynamic schema/description updates when enabled function changes", () => {
    let bEnabled = true;
    const reg = buildSubagentRegistration([
      {
        agentName: "a",
        description: "Agent A",
        workflow: "workflow",
        enabled: true,
      },
      {
        agentName: "b",
        description: "Agent B",
        workflow: "workflow",
        enabled: () => bEnabled,
      },
    ]);

    expect(reg).toBeDefined();
    if (reg) {
      const desc = reg.description as () => string;
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
    expect((reg.enabled as () => boolean)()).toBe(true);

    flag = false;
    expect((reg.enabled as () => boolean)()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// defineSubagentWorkflow
// ---------------------------------------------------------------------------

describe("defineSubagentWorkflow", () => {
  it("maps previousThreadId to threadId + continueThread", async () => {
    let capturedPrompt: string | undefined;
    let capturedSession: SubagentSessionInput | undefined;

    const workflow = defineSubagentWorkflow(
      { name: "test", description: "test agent" },
      async (prompt, sessionInput) => {
        capturedPrompt = prompt;
        capturedSession = sessionInput;
        return { toolResponse: "ok", data: null, threadId: "t" };
      }
    );

    await workflow("go", { previousThreadId: "prev-42" });

    expect(capturedPrompt).toBe("go");
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
    expect(capturedSession).toEqual({ agentName: "test", sandboxId: "sb-123" });
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
});
