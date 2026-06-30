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
  [K in keyof T]: JsonSerializableValue<T[K]>;
};

type JsonSerializableValue<V> = V extends JsonValue
  ? V
  : V extends (infer U)[]
    ? JsonSerializableValue<U>[]
    : V extends object
      ? JsonSerializable<V>
      : never;

/**
 * Full state type combining base state with custom state.
 *
 * When custom state redeclares `fileTree`, that declaration *overrides* the
 * base field instead of intersecting with it. This lets a caller narrow the
 * tree's metadata (e.g. `fileTree: FileEntry<MyMeta>[]` to type the resolver
 * output) without producing the unsatisfiable
 * `FileEntry<FileEntryMetadata>[] & FileEntry<MyMeta>[]`.
 *
 * Only the `fileTree` key is stripped from the base before merging — every
 * other base field is preserved exactly, so `keyof TCustom` staying opaque for
 * a generic `TCustom` cannot degrade unrelated fields (e.g. `tools`).
 */
export type AgentState<TCustom extends JsonSerializable<TCustom>> = Omit<
  BaseAgentState,
  keyof TCustom & "fileTree"
> &
  TCustom;

/**
 * The slice of agent state that is persisted alongside the thread in the
 * thread store (e.g. Redis) so that a workflow can terminate, store its
 * state, and be continued or forked later with that state rehydrated.
 *
 * Only fields that make sense to carry across workflow runs belong here.
 * Runtime bookkeeping like status, version, turns, tools, fileTree, token
 * counters, and the system prompt is intentionally NOT persisted — each run
 * rebuilds those from scratch.
 */
export interface PersistedThreadState {
  /** Task map serialized as entries so it round-trips through JSON. */
  tasks: [string, WorkflowTask][];
  /** All custom state fields declared by the caller. */
  custom: Record<string, JsonValue>;
}

/**
 * Result of {@link ThreadOps.loadThreadState}. Bundles the persisted slice
 * (or `null` when none has been saved yet) with the id of the thread adapter
 * that produced it — the adapter's `ADAPTER_ID` const. The adapter id is not
 * persisted; each adapter stamps its own at load time, so callers can surface
 * which adapter backs a thread without hardcoding it.
 */
export interface LoadedThreadState {
  /** Adapter id of the thread adapter (its `ADAPTER_ID` const). */
  adapter: string;
  /** The persisted state slice, or `null` if none has been saved yet. */
  state: PersistedThreadState | null;
}

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

  /**
   * Snapshot the fields that should survive across workflow runs
   * (tasks + all custom state). Safe to pass directly to
   * {@link ThreadOps.saveThreadState}. Rehydrate on the next run with
   * `mergeUpdate({ tasks: new Map(slice.tasks), ...slice.custom })`.
   */
  getPersistedSlice(): PersistedThreadState;

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
