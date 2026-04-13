import {
  condition,
  defineQuery,
  defineUpdate,
  setHandler,
} from "@temporalio/workflow";
import {
  type AgentStatus,
  type BaseAgentState,
  type WorkflowTask,
  isTerminalStatus,
} from "../types";
import type { ToolDefinition } from "../tool-router/types";
import type { AgentState, AgentStateManager, JsonSerializable } from "./types";
import { z } from "zod";

/**
 * Creates an agent state manager for tracking workflow state.
 * Automatically registers Temporal query and update handlers for the agent.
 *
 * @param options.agentName - Unique agent name, used to derive query/update handler names
 * @param options.initialState - Optional initial values for base and custom state.
 *   Use `systemPrompt` here to set the agent's system prompt.
 *   Base state defaults: status="RUNNING", version=0, turns=0, tasks=empty
 *
 * @example
 * ```typescript
 * const stateManager = createAgentStateManager({
 *   initialState: {
 *     systemPrompt: "You are a helpful assistant.",
 *   },
 *   agentName: "my-agent",
 * });
 *
 * // With custom state fields
 * const stateManager = createAgentStateManager({
 *   initialState: {
 *     systemPrompt: agentConfig.systemPrompt,
 *     customField: "value",
 *   },
 *   agentName: agentConfig.agentName,
 * });
 * ```
 */
export function createAgentStateManager<
  TCustom extends JsonSerializable<TCustom> = Record<string, never>,
>({
  initialState,
}: {
  initialState?: Partial<BaseAgentState> & TCustom;
}): AgentStateManager<TCustom> {
  let status: AgentStatus = initialState?.status ?? "RUNNING";
  let version = initialState?.version ?? 0;
  let turns = initialState?.turns ?? 0;
  let tools = initialState?.tools ?? [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedWriteTokens = 0;
  let totalCachedReadTokens = 0;
  let totalReasonTokens = 0;
  let systemPrompt = initialState?.systemPrompt;

  const tasks = new Map<string, WorkflowTask>(initialState?.tasks);

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

  const stateQuery = defineQuery<AgentState<TCustom>>("getAgentState");
  const stateChangeUpdate = defineUpdate<AgentState<TCustom>, [number]>(
    "waitForAgentStateChange"
  );

  setHandler(stateQuery, () => buildState());
  setHandler(stateChangeUpdate, async (lastKnownVersion: number) => {
    await condition(
      () => version > lastKnownVersion || isTerminalStatus(status),
      "55s"
    );
    return buildState();
  });

  return {
    stateQuery,
    stateChangeUpdate,

    getStatus(): AgentStatus {
      return status;
    },

    isRunning(): boolean {
      return status === "RUNNING";
    },

    getSystemPrompt(): unknown {
      return systemPrompt;
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

    mergeUpdate(update: Partial<TCustom>): void {
      Object.assign(customState as object, update);
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

    setSystemPrompt(newSystemPrompt: unknown): void {
      systemPrompt = newSystemPrompt;
    },

    deleteTask(id: string): boolean {
      const deleted = tasks.delete(id);
      if (deleted) {
        version++;
      }
      return deleted;
    },

    updateUsage(usage: {
      inputTokens?: number;
      outputTokens?: number;
      cachedWriteTokens?: number;
      cachedReadTokens?: number;
      reasonTokens?: number;
    }): void {
      totalInputTokens += usage.inputTokens ?? 0;
      totalOutputTokens += usage.outputTokens ?? 0;
      totalCachedWriteTokens += usage.cachedWriteTokens ?? 0;
      totalCachedReadTokens += usage.cachedReadTokens ?? 0;
      totalReasonTokens += usage.reasonTokens ?? 0;
    },

    getTotalUsage(): {
      totalInputTokens: number;
      totalOutputTokens: number;
      totalCachedWriteTokens: number;
      totalCachedReadTokens: number;
      totalReasonTokens: number;
      turns: number;
    } {
      return {
        totalInputTokens,
        totalOutputTokens,
        totalCachedWriteTokens,
        totalCachedReadTokens,
        totalReasonTokens,
        turns,
      };
    },
  };
}
