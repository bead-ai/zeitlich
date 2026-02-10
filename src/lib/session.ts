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

async function resolvePrompt(
  prompt: string | (() => string | Promise<string>)
): Promise<string> {
  if (typeof prompt === "function") {
    return prompt();
  }
  return prompt;
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
  baseSystemPrompt,
  instructionsPrompt,
  buildContextMessage,
  buildFileTree = async (): Promise<string> => "",
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

  const fileTree = await buildFileTree();

  const toolRouter = createToolRouter({
    tools,
    appendToolResult,
    threadId,
    hooks,
    fileTree,
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
        [
          await resolvePrompt(baseSystemPrompt),
          await resolvePrompt(instructionsPrompt),
        ].join("\n")
      );
      await appendHumanMessage(threadId, await buildContextMessage());

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

          // Parse tool calls, catching schema errors and returning them to the agent
          const parsedToolCalls: ParsedToolCallUnion<T>[] = [];
          for (const tc of rawToolCalls.filter(
            (tc: RawToolCall) => tc.name !== "Task"
          )) {
            try {
              parsedToolCalls.push(toolRouter.parseToolCall(tc));
            } catch (error) {
              await appendToolResult({
                threadId,
                toolCallId: tc.id ?? "",
                content: JSON.stringify({
                  error: `Invalid tool call for "${tc.name}": ${error instanceof Error ? error.message : String(error)}`,
                }),
              });
            }
          }

          const taskToolCalls: ParsedToolCall<
            "Task",
            TaskToolSchemaType<SubagentConfig[]>
          >[] = [];
          if (subagents && subagents.length > 0) {
            for (const tc of rawToolCalls.filter(
              (tc: RawToolCall) => tc.name === "Task"
            )) {
              try {
                const parsedArgs = createTaskTool(subagents).schema.parse(
                  tc.args
                );
                taskToolCalls.push({
                  id: tc.id ?? "",
                  name: tc.name,
                  args: parsedArgs,
                } as ParsedToolCall<
                  "Task",
                  TaskToolSchemaType<SubagentConfig[]>
                >);
              } catch (error) {
                await appendToolResult({
                  threadId,
                  toolCallId: tc.id ?? "",
                  content: JSON.stringify({
                    error: `Invalid tool call for "Task": ${error instanceof Error ? error.message : String(error)}`,
                  }),
                });
              }
            }
          }

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
