import {
  type AgentStatus,
  type BaseAgentState,
  isTerminalStatus,
} from "./types";

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
 * Configuration for creating an agent state manager
 */
export interface AgentStateManagerConfig<
  TCustom extends JsonSerializable<TCustom>,
> {
  /** Initial values for custom state keys */
  initialState: TCustom;
}

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
}

/**
 * Creates an agent state manager for tracking workflow state.
 *
 * The manager owns all state internally:
 * - Default state: status, version (from BaseAgentState)
 * - Custom state: provided via initialState config
 *
 * Note: Due to Temporal's workflow isolation, handlers must be set up
 * in the workflow file using defineQuery/defineUpdate and setHandler.
 * This manager provides the state and logic needed for those handlers.
 */
export function createAgentStateManager<
  TCustom extends JsonSerializable<TCustom> = Record<string, never>,
>(config?: AgentStateManagerConfig<TCustom>): AgentStateManager<TCustom> {
  // Default state (BaseAgentState fields)
  let status: AgentStatus = "RUNNING";
  let version = 0;
  let turns = 0;

  // Custom state
  const customState = { ...(config?.initialState ?? ({} as TCustom)) };

  function buildState(): AgentState<TCustom> {
    return {
      status,
      version,
      turns,
      ...customState,
    } as AgentState<TCustom>;
  }

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
