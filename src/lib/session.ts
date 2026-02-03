import { proxyActivities } from "@temporalio/workflow";
import type { ZeitlichSharedActivities } from "../activities";
import type {
  ZeitlichAgentConfig,
  RunAgentActivity,
  SessionStartHook,
  SessionEndHook,
  SessionExitReason,
} from "./types";
import { type AgentStateManager, type JsonSerializable } from "./state-manager";
import type { PromptManager } from "./prompt-manager";
import type { RawToolCall, ToolMap, ToolRegistry } from "./tool-registry";
import type { ToolRouter } from "./tool-router";
import type { StoredMessage } from "@langchain/core/messages";

// Re-export subagent support for easy access
export { withSubagentSupport } from "./subagent-support";
export type {
  SubagentSupportConfig,
  SubagentSupportResult,
} from "./subagent-support";

export interface ZeitlichSession {
  runSession<T extends JsonSerializable<T>>(
    prompt: string,
    stateManager: AgentStateManager<T>
  ): Promise<StoredMessage | null>;
}

/**
 * Session-level hooks for lifecycle events
 */
export interface SessionLifecycleHooks {
  /** Called when session starts */
  onSessionStart?: SessionStartHook;
  /** Called when session ends */
  onSessionEnd?: SessionEndHook;
}

export const createSession = async <
  T extends ToolMap,
  TResults extends Record<string, unknown>,
>(
  { threadId, agentName, maxTurns = 50, metadata = {} }: ZeitlichAgentConfig,
  {
    runAgent,
    promptManager,
    toolRouter,
    toolRegistry,
    hooks = {},
  }: {
    /** Workflow-specific runAgent activity (with tools pre-bound) */
    runAgent: RunAgentActivity;
    promptManager: PromptManager;
    /** Tool router for processing tool calls (optional if agent has no tools) */
    toolRouter?: ToolRouter<T, TResults>;
    /** Tool registry for parsing tool calls (optional if agent has no tools) */
    toolRegistry?: ToolRegistry<T>;
    /** Session lifecycle hooks */
    hooks?: SessionLifecycleHooks;
  }
): Promise<ZeitlichSession> => {
  const { initializeThread, appendHumanMessage, parseToolCalls } =
    proxyActivities<ZeitlichSharedActivities>({
      startToCloseTimeout: "30m",
      retry: {
        maximumAttempts: 6,
        initialInterval: "5s",
        maximumInterval: "15m",
        backoffCoefficient: 4,
      },
      heartbeatTimeout: "5m",
    });

  // Helper to call session end hook
  const callSessionEnd = async (
    exitReason: SessionExitReason,
    turns: number
  ): Promise<void> => {
    if (hooks.onSessionEnd) {
      await hooks.onSessionEnd({
        threadId,
        agentName,
        exitReason,
        turns,
        metadata,
      });
    }
  };

  return {
    runSession: async (
      prompt: string,
      stateManager
    ): Promise<StoredMessage | null> => {
      if (hooks.onSessionStart) {
        await hooks.onSessionStart({
          threadId,
          agentName,
          metadata,
        });
      }

      await initializeThread(threadId);
      await appendHumanMessage(
        threadId,
        await promptManager.buildContextMessage(prompt)
      );

      let exitReason: SessionExitReason = "completed";

      try {
        while (
          stateManager.isRunning() &&
          !stateManager.isTerminal() &&
          stateManager.getTurns() < maxTurns
        ) {
          stateManager.incrementTurns();
          const currentTurn = stateManager.getTurns();

          const { message, stopReason } = await runAgent(
            {
              threadId,
              agentName,
              metadata,
            },
            {
              systemPrompt: await promptManager.getSystemPrompt(),
            }
          );

          if (stopReason === "end_turn") {
            stateManager.complete();
            exitReason = "completed";
            return message;
          }

          // No tools configured - treat any non-end_turn as completed
          if (!toolRouter || !toolRegistry) {
            stateManager.complete();
            exitReason = "completed";
            return message;
          }

          const rawToolCalls: RawToolCall[] = await parseToolCalls(message);
          const parsedToolCalls = rawToolCalls.map((tc: RawToolCall) =>
            toolRegistry.parseToolCall(tc)
          );

          // Hooks can call stateManager.waitForInput() to pause the session
          await toolRouter.processToolCalls(parsedToolCalls, {
            turn: currentTurn,
          });

          if (stateManager.getStatus() === "WAITING_FOR_INPUT") {
            exitReason = "waiting_for_input";
            break;
          }
        }

        // Check if we hit max turns
        if (stateManager.getTurns() >= maxTurns && stateManager.isRunning()) {
          exitReason = "max_turns";
        }
      } catch (error) {
        exitReason = "failed";
        throw error;
      } finally {
        // SessionEnd hook - always called
        await callSessionEnd(exitReason, stateManager.getTurns());
      }

      return null;
    },
  };
};
