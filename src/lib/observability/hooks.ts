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
 * Combine with your own hooks using spread; every hook slot also accepts
 * an array, run in order:
 *
 * ```typescript
 * const obs = createObservabilityHooks("myAgent");
 * const session = await createSession({
 *   hooks: {
 *     ...obs,
 *     onSessionEnd: [obs.onSessionEnd, myCustomEndHook],
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
