import { proxyActivities } from "@temporalio/workflow";
import type { ZeitlichSharedActivities } from "../activities";
import type {
  ZeitlichAgentConfig,
  SessionStartHook,
  SessionEndHook,
  SessionExitReason,
  SubagentConfig,
} from "./types";
import { type AgentStateManager, type JsonSerializable } from "./state-manager";
import {
  createToolRouter,
  type ParsedToolCall,
  type ParsedToolCallUnion,
  type RawToolCall,
  type ToolMap,
} from "./tool-router";
import type { StoredMessage } from "@langchain/core/messages";
import { createTaskTool, type TaskToolSchemaType } from "../tools/task/tool";

export interface ZeitlichSession {
  runSession<T extends JsonSerializable<T>>(args: {
    stateManager: AgentStateManager<T>;
  }): Promise<StoredMessage | null>;
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

export const createSession = async <T extends ToolMap>({
  threadId,
  agentName,
  maxTurns = 50,
  metadata = {},
  runAgent,
  promptManager,
  subagents,
  tools = {} as T,
  processToolsInParallel = true,
  hooks = {},
}: ZeitlichAgentConfig<T>): Promise<ZeitlichSession> => {
  const {
    initializeThread,
    appendHumanMessage,
    parseToolCalls,
    appendToolResult,
    appendSystemMessage,
  } = proxyActivities<ZeitlichSharedActivities>({
    startToCloseTimeout: "30m",
    retry: {
      maximumAttempts: 6,
      initialInterval: "5s",
      maximumInterval: "15m",
      backoffCoefficient: 4,
    },
    heartbeatTimeout: "5m",
  });

  const toolRouter = createToolRouter({
    tools,
    appendToolResult,
    threadId,
    hooks,
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
    runSession: async ({ stateManager }): Promise<StoredMessage | null> => {
      if (hooks.onSessionStart) {
        await hooks.onSessionStart({
          threadId,
          agentName,
          metadata,
        });
      }

      stateManager.setTools(toolRouter.getToolDefinitions());

      await initializeThread(threadId);
      await appendSystemMessage(
        threadId,
        await promptManager.getSystemPrompt()
      );
      await appendHumanMessage(
        threadId,
        await promptManager.buildContextMessage()
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

          const rawToolCalls: RawToolCall[] = await parseToolCalls(message);
          const parsedToolCalls = rawToolCalls
            .filter((tc: RawToolCall) => tc.name !== "Task")
            .map((tc: RawToolCall) => toolRouter.parseToolCall(tc));
          const taskToolCalls =
            subagents && subagents.length > 0
              ? rawToolCalls
                  .filter((tc: RawToolCall) => tc.name === "Task")
                  .map((tc: RawToolCall) => {
                    // Parse and validate args using the tool's schema
                    const parsedArgs = createTaskTool(subagents).schema.parse(
                      tc.args
                    );

                    return {
                      id: tc.id ?? "",
                      name: tc.name,
                      args: parsedArgs,
                    } as ParsedToolCall<
                      "Task",
                      TaskToolSchemaType<SubagentConfig[]>
                    >;
                  })
              : [];

          // Hooks can call stateManager.waitForInput() to pause the session
          await toolRouter.processToolCalls(
            [...parsedToolCalls, ...taskToolCalls] as ParsedToolCallUnion<
              T & { Task: TaskToolSchemaType<SubagentConfig[]> }
            >[],
            {
              turn: currentTurn,
            }
          );

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
