import {
  condition,
  defineQuery,
  defineUpdate,
  setHandler,
} from "@temporalio/workflow";
import {
  type AgentConfig,
  type AgentStatus,
  type BaseAgentState,
  type WorkflowTask,
  isTerminalStatus,
} from "./types";
import type { ToolDefinition } from "./tool-router";
import { z } from "zod";

/**
 * JSON primitive types that Temporal can serialize
 */
export type JsonPrimitive = string | number | boolean | null | undefined;

/**
 * JSON-serializable value (recursive type for Temporal compatibility)
 */
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Type constraint ensuring T only contains JSON-serializable values.
 * Use this for custom state to ensure Temporal workflow compatibility.
 *
 * Allows: primitives, arrays, plain objects, and JsonValue
 * Rejects: functions, symbols, undefined, class instances with methods
 */
export type JsonSerializable<T> = {
  [K in keyof T]: T[K] extends JsonValue
    ? T[K]
    : T[K] extends JsonPrimitive
      ? T[K]
      : T[K] extends (infer U)[]
        ? U extends JsonValue
          ? T[K]
          : JsonSerializable<U>[]
        : T[K] extends object
          ? JsonSerializable<T[K]>
          : never;
};

/**
 * Full state type combining base state with custom state
 */
export type AgentState<TCustom extends JsonSerializable<TCustom>> =
  BaseAgentState & TCustom;

/**
 * Agent state manager interface
 * Note: Temporal handlers must be set up in the workflow file due to
 * Temporal's workflow isolation requirements. This manager provides
 * the state and helpers needed for those handlers.
 */
export interface AgentStateManager<TCustom extends JsonSerializable<TCustom>> {
  /** Get current status */
  getStatus(): AgentStatus;
  /** Check if agent is running */
  isRunning(): boolean;
  /** Check if agent is in terminal state */
  isTerminal(): boolean;
  /** Get current state version */
  getVersion(): number;

  /** Set status to RUNNING */
  run(): void;
  /** Set status to WAITING_FOR_INPUT */
  waitForInput(): void;
  /** Set status to COMPLETED */
  complete(): void;
  /** Set status to FAILED */
  fail(): void;
  /** Set status to CANCELLED */
  cancel(): void;

  /** Increment state version (call after state changes) */
  incrementVersion(): void;

  /** Increment turns (call after each turn) */
  incrementTurns(): void;

  /** Get current turns */
  getTurns(): number;

  /** Get a custom state value by key */
  get<K extends keyof TCustom>(key: K): TCustom[K];

  /** Set a custom state value by key */
  set<K extends keyof TCustom>(key: K, value: TCustom[K]): void;

  /** Get full state for query handler */
  getCurrentState(): AgentState<TCustom>;

  /** Check if should return from waitForStateChange */
  shouldReturnFromWait(lastKnownVersion: number): boolean;

  // Task management methods
  /** Get all tasks */
  getTasks(): WorkflowTask[];
  /** Get a task by ID */
  getTask(id: string): WorkflowTask | undefined;
  /** Add or update a task */
  setTask(task: WorkflowTask): void;
  /** Delete a task by ID */
  deleteTask(id: string): boolean;

  /** Set the tools (converts Zod schemas to JSON Schema for serialization) */
  setTools(newTools: ToolDefinition[]): void;
}

/**
 * Creates an agent state manager for tracking workflow state.
 *
 * @param initialState - Optional initial values for base and custom state
 *   Base state defaults: status="RUNNING", version=0, turns=0, tasks=empty, fileTree=[]
 *
 * Note: Due to Temporal's workflow isolation, handlers must be set up
 * in the workflow file using defineQuery/defineUpdate and setHandler.
 * This manager provides the state and logic needed for those handlers.
 */
export function createAgentStateManager<
  TCustom extends JsonSerializable<TCustom> = Record<string, never>,
>({
  initialState,
  agentConfig,
}: {
  initialState?: Partial<BaseAgentState> & TCustom;
  agentConfig: AgentConfig;
}): AgentStateManager<TCustom> {
  // Default state (BaseAgentState fields)
  let status: AgentStatus = initialState?.status ?? "RUNNING";
  let version = initialState?.version ?? 0;
  let turns = initialState?.turns ?? 0;
  let tools = initialState?.tools ?? [];

  // Tasks state
  const tasks = new Map<string, WorkflowTask>(initialState?.tasks);

  // Custom state - extract only custom fields (exclude base state keys)
  const {
    status: _,
    version: __,
    turns: ___,
    tasks: ____,
    tools: _____,
    ...custom
  } = initialState ?? {};
  const customState = custom as TCustom;

  function buildState(): AgentState<TCustom> {
    return {
      status,
      version,
      turns,
      tools,
      ...customState,
    } as AgentState<TCustom>;
  }

  setHandler(defineQuery(`get${agentConfig.agentName}State`), () => {
    return buildState();
  });

  setHandler(
    defineUpdate<AgentState<TCustom>, [number]>(
      `waitFor${agentConfig.agentName}StateChange`
    ),
    async (lastKnownVersion: number) => {
      await condition(
        () => version > lastKnownVersion || isTerminalStatus(status),
        "55s"
      );
      return buildState();
    }
  );

  return {
    getStatus(): AgentStatus {
      return status;
    },

    isRunning(): boolean {
      return status === "RUNNING";
    },

    isTerminal(): boolean {
      return isTerminalStatus(status);
    },

    getTurns(): number {
      return turns;
    },

    getVersion(): number {
      return version;
    },

    run(): void {
      status = "RUNNING";
      version++;
    },

    waitForInput(): void {
      status = "WAITING_FOR_INPUT";
      version++;
    },

    complete(): void {
      status = "COMPLETED";
      version++;
    },

    fail(): void {
      status = "FAILED";
      version++;
    },

    cancel(): void {
      status = "CANCELLED";
      version++;
    },

    incrementVersion(): void {
      version++;
    },

    incrementTurns(): void {
      turns++;
    },

    get<K extends keyof TCustom>(key: K): TCustom[K] {
      return customState[key];
    },

    set<K extends keyof TCustom>(key: K, value: TCustom[K]): void {
      customState[key] = value;
      version++;
    },

    getCurrentState(): AgentState<TCustom> {
      return buildState();
    },

    shouldReturnFromWait(lastKnownVersion: number): boolean {
      return version > lastKnownVersion || isTerminalStatus(status);
    },

    getTasks(): WorkflowTask[] {
      return Array.from(tasks.values());
    },

    getTask(id: string): WorkflowTask | undefined {
      return tasks.get(id);
    },

    setTask(task: WorkflowTask): void {
      tasks.set(task.id, task);
      version++;
    },

    setTools(newTools: ToolDefinition[]): void {
      tools = newTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        schema: z.toJSONSchema(tool.schema) as Record<string, unknown>,
        strict: tool.strict,
        max_uses: tool.max_uses,
      }));
    },

    deleteTask(id: string): boolean {
      const deleted = tasks.delete(id);
      if (deleted) {
        version++;
      }
      return deleted;
    },
  };
}

/**
 * Handler names used across agents
 */
export const AGENT_HANDLER_NAMES = {
  getAgentState: "getAgentState",
  waitForStateChange: "waitForStateChange",
  addMessage: "addMessage",
} as const;
