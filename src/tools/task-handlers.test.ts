import { describe, expect, it, vi } from "vitest";
import type { AgentStateManager } from "../lib/state-manager";
import type { WorkflowTask } from "../lib/types";

vi.mock("@temporalio/workflow", () => ({
  uuid4: () => "test-uuid-1234",
}));

import { createTaskCreateHandler } from "./task-create/handler";
import { createTaskGetHandler } from "./task-get/handler";
import { createTaskListHandler } from "./task-list/handler";
import { createTaskUpdateHandler } from "./task-update/handler";

function createMockStateManager(): AgentStateManager<Record<string, never>> & {
  _tasks: Map<string, WorkflowTask>;
} {
  const tasks = new Map<string, WorkflowTask>();
  return {
    _tasks: tasks,
    getTasks: () => Array.from(tasks.values()),
    getTask: (id: string) => tasks.get(id),
    setTask: (task: WorkflowTask) => {
      tasks.set(task.id, task);
    },
    deleteTask: (id: string) => tasks.delete(id),
  } as AgentStateManager<Record<string, never>> & {
    _tasks: Map<string, WorkflowTask>;
  };
}

describe("TaskCreate handler", () => {
  it("creates a task with pending status", async () => {
    const sm = createMockStateManager();
    const handler = createTaskCreateHandler(sm);

    const result = await handler(
      {
        subject: "Fix bug",
        description: "Fix the login bug",
        activeForm: "Fixing bug",
        metadata: { priority: "high" },
      },
      {}
    );

    expect(result.data.id).toBe("test-uuid-1234");
    expect(result.data.subject).toBe("Fix bug");
    expect(result.data.description).toBe("Fix the login bug");
    expect(result.data.activeForm).toBe("Fixing bug");
    expect(result.data.status).toBe("pending");
    expect(result.data.metadata).toEqual({ priority: "high" });
    expect(result.data.blockedBy).toEqual([]);
    expect(result.data.blocks).toEqual([]);

    expect(sm._tasks.has("test-uuid-1234")).toBe(true);
    expect(typeof result.toolResponse).toBe("string");
  });

  it("defaults metadata to empty object", async () => {
    const sm = createMockStateManager();
    const handler = createTaskCreateHandler(sm);

    const result = await handler(
      {
        subject: "Task",
        description: "Desc",
        activeForm: "Working",
        metadata: {},
      },
      {}
    );

    expect(result.data.metadata).toEqual({});
  });
});

describe("TaskGet handler", () => {
  it("returns a task by ID", async () => {
    const sm = createMockStateManager();
    const task: WorkflowTask = {
      id: "task-1",
      subject: "Test",
      description: "Desc",
      activeForm: "Testing",
      status: "pending",
      metadata: {},
      blockedBy: [],
      blocks: [],
    };
    sm._tasks.set("task-1", task);

    const handler = createTaskGetHandler(sm);
    const result = await handler({ taskId: "task-1" }, {});

    expect(result.data).toEqual(task);
  });

  it("returns null for missing task", async () => {
    const sm = createMockStateManager();
    const handler = createTaskGetHandler(sm);
    const result = await handler({ taskId: "missing" }, {});

    expect(result.data).toBeNull();
    expect(result.toolResponse).toContain("not found");
  });
});

describe("TaskList handler", () => {
  it("returns all tasks", async () => {
    const sm = createMockStateManager();
    const t1: WorkflowTask = {
      id: "t1",
      subject: "A",
      description: "D",
      activeForm: "Doing A",
      status: "pending",
      metadata: {},
      blockedBy: [],
      blocks: [],
    };
    const t2: WorkflowTask = {
      id: "t2",
      subject: "B",
      description: "D",
      activeForm: "Doing B",
      status: "in_progress",
      metadata: {},
      blockedBy: [],
      blocks: [],
    };
    sm._tasks.set("t1", t1);
    sm._tasks.set("t2", t2);

    const handler = createTaskListHandler(sm);
    const result = await handler({}, {});

    expect(result.data).toHaveLength(2);
  });

  it("returns empty array when no tasks", async () => {
    const sm = createMockStateManager();
    const handler = createTaskListHandler(sm);
    const result = await handler({}, {});

    expect(result.data).toEqual([]);
  });
});

describe("TaskUpdate handler", () => {
  function seedTask(
    sm: ReturnType<typeof createMockStateManager>,
    overrides: Partial<WorkflowTask> = {}
  ): WorkflowTask {
    const task: WorkflowTask = {
      id: "task-1",
      subject: "Test",
      description: "Desc",
      activeForm: "Testing",
      status: "pending",
      metadata: {},
      blockedBy: [],
      blocks: [],
      ...overrides,
    };
    sm._tasks.set(task.id, task);
    return task;
  }

  it("updates task status", async () => {
    const sm = createMockStateManager();
    seedTask(sm);

    const handler = createTaskUpdateHandler(sm);
    const result = await handler(
      {
        taskId: "task-1",
        status: "completed",
        addBlockedBy: [],
        addBlocks: [],
      },
      {}
    );

    expect(result.data?.status).toBe("completed");
  });

  it("adds bidirectional blockedBy relationship", async () => {
    const sm = createMockStateManager();
    seedTask(sm, { id: "task-1" });
    seedTask(sm, { id: "task-2" });

    const handler = createTaskUpdateHandler(sm);
    await handler(
      {
        taskId: "task-1",
        status: "pending",
        addBlockedBy: ["task-2"],
        addBlocks: [],
      },
      {}
    );

    const t1 = sm._tasks.get("task-1");
    const t2 = sm._tasks.get("task-2");

    expect(t1?.blockedBy).toContain("task-2");
    expect(t2?.blocks).toContain("task-1");
  });

  it("adds bidirectional blocks relationship", async () => {
    const sm = createMockStateManager();
    seedTask(sm, { id: "task-1" });
    seedTask(sm, { id: "task-2" });

    const handler = createTaskUpdateHandler(sm);
    await handler(
      {
        taskId: "task-1",
        status: "pending",
        addBlockedBy: [],
        addBlocks: ["task-2"],
      },
      {}
    );

    const t1 = sm._tasks.get("task-1");
    const t2 = sm._tasks.get("task-2");

    expect(t1?.blocks).toContain("task-2");
    expect(t2?.blockedBy).toContain("task-1");
  });

  it("returns null for missing task", async () => {
    const sm = createMockStateManager();
    const handler = createTaskUpdateHandler(sm);
    const result = await handler(
      {
        taskId: "missing",
        status: "completed",
        addBlockedBy: [],
        addBlocks: [],
      },
      {}
    );

    expect(result.data).toBeNull();
  });

  it("does not duplicate existing relationships", async () => {
    const sm = createMockStateManager();
    seedTask(sm, { id: "task-1", blockedBy: ["task-2"] });
    seedTask(sm, { id: "task-2", blocks: ["task-1"] });

    const handler = createTaskUpdateHandler(sm);
    await handler(
      {
        taskId: "task-1",
        status: "pending",
        addBlockedBy: ["task-2"],
        addBlocks: [],
      },
      {}
    );

    const t1 = sm._tasks.get("task-1");
    expect(t1?.blockedBy.filter((id) => id === "task-2")).toHaveLength(1);
  });
});
