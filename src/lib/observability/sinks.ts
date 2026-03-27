import type { Sinks } from "@temporalio/workflow";
import type { TokenUsage, SessionExitReason } from "../types";

// ============================================================================
// Sink Event Types
// ============================================================================

export interface SessionStartedEvent {
  agentName: string;
  threadId: string;
  metadata: Record<string, unknown>;
}

export interface SessionEndedEvent {
  agentName: string;
  threadId: string;
  exitReason: SessionExitReason;
  turns: number;
  usage: TokenUsage;
  durationMs: number;
}

export interface TurnCompletedEvent {
  agentName: string;
  threadId: string;
  turn: number;
  toolCallCount: number;
  usage?: TokenUsage;
}

export interface ToolExecutedEvent {
  agentName: string;
  toolName: string;
  durationMs: number;
  success: boolean;
  threadId: string;
  turn: number;
}

// ============================================================================
// Sink Interface
// ============================================================================

/**
 * Temporal Sinks interface for zeitlich agent observability.
 *
 * Sinks bridge the workflow sandbox to the Node.js environment, allowing
 * consumers to emit metrics (Prometheus, Datadog, OpenTelemetry, etc.)
 * from agent lifecycle events without breaking determinism.
 *
 * Register on the Worker via `InjectedSinks<ZeitlichObservabilitySinks>`:
 *
 * ```typescript
 * import { Worker, InjectedSinks } from "@temporalio/worker";
 * import type { ZeitlichObservabilitySinks } from "zeitlich/workflow";
 *
 * const sinks: InjectedSinks<ZeitlichObservabilitySinks> = {
 *   zeitlichMetrics: {
 *     sessionStarted: {
 *       fn(workflowInfo, event) { counter.inc({ agent: event.agentName }); },
 *       callDuringReplay: false,
 *     },
 *     sessionEnded: {
 *       fn(workflowInfo, event) { histogram.observe(event.durationMs); },
 *       callDuringReplay: false,
 *     },
 *     turnCompleted: {
 *       fn(workflowInfo, event) { gauge.set(event.turn); },
 *       callDuringReplay: false,
 *     },
 *     toolExecuted: {
 *       fn(workflowInfo, event) { histogram.observe({ tool: event.toolName }, event.durationMs); },
 *       callDuringReplay: false,
 *     },
 *   },
 * };
 *
 * const worker = await Worker.create({ sinks, ... });
 * ```
 */
export interface ZeitlichObservabilitySinks extends Sinks {
  zeitlichMetrics: {
    sessionStarted(event: SessionStartedEvent): void;
    sessionEnded(event: SessionEndedEvent): void;
    turnCompleted(event: TurnCompletedEvent): void;
    toolExecuted(event: ToolExecutedEvent): void;
  };
}
