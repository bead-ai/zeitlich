import { proxyActivities } from "@temporalio/workflow";
import type { ZeitlichSharedActivities } from "../activities";
import type {
  ThreadOps,
  ZeitlichAgentConfig,
  SessionStartHook,
  SessionEndHook,
  SessionExitReason,
} from "./types";
import type { StoredMessage } from "@langchain/core/messages";
import { type AgentStateManager, type JsonSerializable } from "./state-manager";
import {
  createToolRouter,
  type ParsedToolCallUnion,
  type RawToolCall,
  type ToolMap,
} from "./tool-router";

export interface ZeitlichSession<M = unknown> {
  runSession<T extends JsonSerializable<T>>(args: {
    stateManager: AgentStateManager<T>;
  }): Promise<M | null>;
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

export const createSession = async <T extends ToolMap, M = unknown>({
  threadId,
  agentName,
  maxTurns = 50,
  metadata = {},
  runAgent,
  threadOps,
  buildContextMessage,
  subagents,
  tools = {} as T,
  processToolsInParallel = true,
  hooks = {},
}: ZeitlichAgentConfig<T, M>): Promise<ZeitlichSession<M>> => {
  const toolRouter = createToolRouter({
    tools,
    appendToolResult: threadOps.appendToolResult,
    threadId,
    hooks,
    subagents,
    parallel: processToolsInParallel,
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
    runSession: async ({ stateManager }): Promise<M | null> => {
      if (hooks.onSessionStart) {
        await hooks.onSessionStart({
          threadId,
          agentName,
          metadata,
        });
      }
      stateManager.setTools(toolRouter.getToolDefinitions());

      await threadOps.initializeThread(threadId);
      await threadOps.appendHumanMessage(threadId, await buildContextMessage());

      let exitReason: SessionExitReason = "completed";

      try {
        while (
          stateManager.isRunning() &&
          !stateManager.isTerminal() &&
          stateManager.getTurns() < maxTurns
        ) {
          stateManager.incrementTurns();
          const currentTurn = stateManager.getTurns();

          const { message, stopReason } = await runAgent({
            threadId,
            agentName,
            metadata,
          });

          if (stopReason === "end_turn") {
            stateManager.complete();
            exitReason = "completed";
            return message;
          }

          // No tools configured - treat any non-end_turn as completed
          if (!toolRouter.hasTools()) {
            stateManager.complete();
            exitReason = "completed";
            return message;
          }

          const rawToolCalls: RawToolCall[] =
            await threadOps.parseToolCalls(message);

          // Parse all tool calls uniformly through the router
          const parsedToolCalls: ParsedToolCallUnion<T>[] = [];
          for (const tc of rawToolCalls) {
            try {
              parsedToolCalls.push(toolRouter.parseToolCall(tc));
            } catch (error) {
              await threadOps.appendToolResult({
                threadId,
                toolCallId: tc.id ?? "",
                toolName: tc.name,
                content: JSON.stringify({
                  error: `Invalid tool call for "${tc.name}": ${error instanceof Error ? error.message : String(error)}`,
                }),
              });
            }
          }

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

/**
 * Proxy the default ZeitlichSharedActivities as ThreadOps<StoredMessage>.
 * Call this in workflow code for the standard LangChain/StoredMessage setup.
 *
 * @example
 * ```typescript
 * const session = await createSession({
 *   threadOps: proxyDefaultThreadOps(),
 *   // ...
 * });
 * ```
 */
export function proxyDefaultThreadOps(
  options?: Parameters<typeof proxyActivities>[0]
): ThreadOps<StoredMessage> {
  const activities = proxyActivities<ZeitlichSharedActivities>(
    options ?? {
      startToCloseTimeout: "30m",
      retry: {
        maximumAttempts: 6,
        initialInterval: "5s",
        maximumInterval: "15m",
        backoffCoefficient: 4,
      },
      heartbeatTimeout: "5m",
    }
  );

  return {
    initializeThread: activities.initializeThread,
    appendHumanMessage: activities.appendHumanMessage,
    appendToolResult: activities.appendToolResult,
    parseToolCalls: activities.parseToolCalls,
  };
}
