import type { QueryDefinition } from "@temporalio/workflow";
import type { UpdateDefinition } from "@temporalio/common/lib/interfaces";
import type {
  AgentStatus,
  BaseAgentState,
  TokenUsage,
  WorkflowTask,
} from "../types";
import type { ToolDefinition } from "../tool-router/types";

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
  /** Typed query definition registered for this agent's state */
  readonly stateQuery: QueryDefinition<AgentState<TCustom>>;
  /** Typed update definition registered for waiting on this agent's state change */
  readonly stateChangeUpdate: UpdateDefinition<AgentState<TCustom>, [number]>;

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

  /** Get the system prompt */
  getSystemPrompt(): unknown;

  /** Set the system prompt */
  setSystemPrompt(newSystemPrompt: unknown): void;

  /** Get a custom state value by key */
  get<K extends keyof TCustom>(key: K): TCustom[K];

  /** Set a custom state value by key */
  set<K extends keyof TCustom>(key: K, value: TCustom[K]): void;

  /** Bulk-merge a partial update into custom state */
  mergeUpdate(update: Partial<AgentState<TCustom>>): void;

  /** Get full state for query handler */
  getCurrentState(): AgentState<TCustom>;

  /** Check if should return from waitForStateChange */
  shouldReturnFromWait(lastKnownVersion: number): boolean;

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

  /** Update the usage */
  updateUsage(usage: TokenUsage): void;

  /** Get the total usage */
  getTotalUsage(): {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCachedWriteTokens: number;
    totalCachedReadTokens: number;
    totalReasonTokens: number;
    turns: number;
  };
}
