import type { AgentStateManager, JsonSerializable } from "../state/types";

/**
 * Creates a `resolveSettings` factory that picks keys from a parent agent's
 * state manager, producing type-safe settings for a subagent.
 *
 * Use this with `defineSubagent({ resolveSettings: ... })` to automatically
 * forward parent state to subagents without manual value passing.
 *
 * @example
 * ```ts
 * interface ParentState { model: string; apiKey: string; verbose: boolean }
 *
 * const stateManager = createAgentStateManager<ParentState>({ ... });
 *
 * const researcher = defineSubagent({
 *   agentName: "researcher",
 *   description: "Researches topics",
 *   workflow: researcherWorkflow,
 *   resolveSettings: bindSubagentState(stateManager, ["model", "apiKey"]),
 *   //                                                ^-- auto-picks { model: string; apiKey: string }
 * });
 * ```
 *
 * @param stateManager - The parent agent's state manager
 * @param keys - Keys from the parent's custom state to forward to the subagent
 * @returns A function that reads the specified keys from state at invocation time
 */
export function bindSubagentState<
  TCustom extends JsonSerializable<TCustom>,
  const TKey extends keyof TCustom & string,
>(
  stateManager: AgentStateManager<TCustom>,
  keys: readonly TKey[],
): () => Pick<TCustom, TKey> {
  return () => {
    const result = {} as Pick<TCustom, TKey>;
    for (const key of keys) {
      result[key] = stateManager.get(key);
    }
    return result;
  };
}
