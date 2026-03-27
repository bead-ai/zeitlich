import { proxySinks } from "@temporalio/workflow";
import type { ZeitlichObservabilitySinks } from "./sinks";
import type {
  SessionStartHook,
  SessionEndHook,
} from "../hooks/types";
import type {
  PostToolUseHook,
  PostToolUseFailureHook,
} from "../tool-router/types";

export interface ObservabilityHooks {
  onSessionStart: SessionStartHook;
  onSessionEnd: SessionEndHook;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onPostToolUse: PostToolUseHook<any, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onPostToolUseFailure: PostToolUseFailureHook<any>;
}

/**
 * Creates session hooks that emit agent lifecycle events to
 * {@link ZeitlichObservabilitySinks}.
 *
 * The returned hooks call `proxySinks()` once and forward each event to
 * the `zeitlichMetrics` sink. If the sink is not registered on the Worker,
 * calls are silently dropped by the Temporal runtime.
 *
 * Combine with your own hooks using spread or {@link composeHooks}:
 *
 * ```typescript
 * const session = await createSession({
 *   hooks: {
 *     ...createObservabilityHooks("myAgent"),
 *     // additional hooks can be composed via composeHooks()
 *   },
 * });
 * ```
 *
 * @param agentName - Agent name attached to every emitted event
 */
export function createObservabilityHooks(agentName: string): ObservabilityHooks {
  const { zeitlichMetrics } = proxySinks<ZeitlichObservabilitySinks>();
  let sessionStartMs = Date.now();

  return {
    onSessionStart: (ctx) => {
      sessionStartMs = Date.now();
      zeitlichMetrics.sessionStarted({
        agentName,
        threadId: ctx.threadId,
        metadata: ctx.metadata,
      });
    },

    onSessionEnd: (ctx) => {
      zeitlichMetrics.sessionEnded({
        agentName,
        threadId: ctx.threadId,
        exitReason: ctx.exitReason,
        turns: ctx.turns,
        usage: {},
        durationMs: Date.now() - sessionStartMs,
      });
    },

    onPostToolUse: (ctx) => {
      zeitlichMetrics.toolExecuted({
        agentName,
        toolName: ctx.toolCall.name,
        durationMs: ctx.durationMs,
        success: true,
        threadId: ctx.threadId,
        turn: ctx.turn,
      });
    },

    onPostToolUseFailure: (ctx) => {
      zeitlichMetrics.toolExecuted({
        agentName,
        toolName: ctx.toolCall.name,
        durationMs: 0,
        success: false,
        threadId: ctx.threadId,
        turn: ctx.turn,
      });
      return {};
    },
  };
}

/**
 * Compose multiple hook functions for the same lifecycle event into one.
 *
 * Each hook is called sequentially in order. Return values from
 * `onPreToolUse` / `onPostToolUseFailure` use the **last** non-undefined
 * result (later hooks can override earlier ones).
 *
 * @example
 * ```typescript
 * const obs = createObservabilityHooks("myAgent");
 * const hooks = {
 *   onSessionEnd: composeHooks(obs.onSessionEnd, myCustomEndHook),
 * };
 * ```
 */
export function composeHooks<TArgs extends unknown[], TReturn>(
  ...fns: ((...args: TArgs) => TReturn | Promise<TReturn>)[]
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    let lastResult!: TReturn;
    for (const fn of fns) {
      lastResult = await fn(...args);
    }
    return lastResult;
  };
}
