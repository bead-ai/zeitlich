import { proxySinks } from "@temporalio/workflow";
import type { ZeitlichObservabilitySinks } from "./sinks";
import type {
  SessionStartHook,
  SessionEndHook,
  TurnCompleteHook,
} from "../hooks/types";
import type {
  PostToolUseHook,
  PostToolUseFailureHook,
  PostToolUseFailureHookResult,
  ToolMap,
} from "../tool-router/types";

export interface ObservabilityHooks {
  onSessionStart: SessionStartHook;
  onSessionEnd: SessionEndHook;
  onTurnComplete: TurnCompleteHook;
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
export function createObservabilityHooks(
  agentName: string
): ObservabilityHooks {
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
        usage: ctx.usage,
        durationMs: Date.now() - sessionStartMs,
      });
    },

    onTurnComplete: (ctx) => {
      zeitlichMetrics.turnCompleted({
        agentName,
        threadId: ctx.threadId,
        turn: ctx.turn,
        toolCallCount: ctx.toolCallCount,
        ...(ctx.usage && { usage: ctx.usage }),
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
      const result = await fn(...args);
      if (result !== undefined) {
        lastResult = result;
      }
    }
    return lastResult;
  };
}

/**
 * Compose multiple `onPostToolUseFailure` hooks into one, preserving the
 * {@link PostToolUseFailureHook} type.
 *
 * Hooks run sequentially; the last *decisive* result wins. A result is
 * decisive when it sets `fallbackContent` or `suppress` — empty results
 * (`{}`, e.g. from observability hooks that only record metrics) and
 * `undefined` never override an earlier hook's recovery, so composition
 * order doesn't silently discard a recovery.
 *
 * Prefer this over {@link composeHooks} for failure hooks: the generic
 * helper returns a rest-tuple function type that skews tool-map inference
 * in `createSession`, forcing consumers to cast the composed hook back to
 * `PostToolUseFailureHook` — and it lets empty results win.
 *
 * @example
 * ```typescript
 * const obs = createObservabilityHooks("myAgent");
 * const hooks = {
 *   onPostToolUseFailure: composeFailureHooks(
 *     obs.onPostToolUseFailure,
 *     myRecoveryHook
 *   ),
 * };
 * ```
 */
export function composeFailureHooks<T extends ToolMap>(
  ...hooks: PostToolUseFailureHook<T>[]
): PostToolUseFailureHook<T> {
  return async (ctx) => {
    let lastResult: PostToolUseFailureHookResult = {};
    for (const hook of hooks) {
      const result = await hook(ctx);
      if (
        result !== undefined &&
        (result.fallbackContent !== undefined || result.suppress !== undefined)
      ) {
        lastResult = result;
      }
    }
    return lastResult;
  };
}
