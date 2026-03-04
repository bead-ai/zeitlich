import {
  proxyActivities,
  condition,
  defineUpdate,
  setHandler,
  ApplicationFailure,
} from "@temporalio/workflow";
import type {
  ThreadOps,
  AgentConfig,
  SessionStartHook,
  SessionEndHook,
  SessionExitReason,
  SessionConfig,
} from "./types";
import { type AgentStateManager, type JsonSerializable } from "./state-manager";
import {
  createToolRouter,
  type ParsedToolCallUnion,
  type ToolMap,
} from "./tool-router";
import type { MessageContent } from "./types";
import { getShortId } from "./thread-id";

export interface ZeitlichSession<M = unknown> {
  runSession<T extends JsonSerializable<T>>(args: {
    stateManager: AgentStateManager<T>;
  }): Promise<{
    finalMessage: M | null;
    exitReason: SessionExitReason;
    usage: ReturnType<AgentStateManager<T>["getTotalUsage"]>;
  }>;
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

/**
 * Creates an agent session that manages the agent loop: LLM invocation,
 * tool routing, subagent coordination, and lifecycle hooks.
 *
 * @param config - Session and agent configuration (merged `SessionConfig` and `AgentConfig`)
 * @returns A session object with `runSession()` to start the agent loop
 *
 * @example
 * ```typescript
 * import { createSession, createAgentStateManager, defineTool, bashTool } from 'zeitlich/workflow';
 *
 * const stateManager = createAgentStateManager({
 *   initialState: { systemPrompt: "You are a helpful assistant." },
 *   agentName: "my-agent",
 * });
 *
 * const session = await createSession({
 *   agentName: "my-agent",
 *   maxTurns: 20,
 *   threadId: runId,
 *   runAgent: runAgentActivity,
 *   buildContextMessage: () => [{ type: "text", text: prompt }],
 *   subagents: [researcherSubagent],
 *   tools: {
 *     Bash: defineTool({ ...bashTool, handler: bashHandlerActivity }),
 *   },
 * });
 *
 * const { finalMessage, exitReason } = await session.runSession({ stateManager });
 * ```
 */
export const createSession = async <T extends ToolMap, M = unknown>({
  threadId: providedThreadId,
  agentName,
  maxTurns = 50,
  metadata = {},
  runAgent,
  threadOps,
  buildContextMessage,
  subagents,
  skills,
  tools = {} as T,
  processToolsInParallel = true,
  hooks = {},
  appendSystemPrompt = true,
  continueThread = false,
  waitForInputTimeout = "48h",
}: SessionConfig<T, M> & AgentConfig): Promise<ZeitlichSession<M>> => {
  const threadId = providedThreadId ?? getShortId();

  const {
    appendToolResult,
    appendHumanMessage,
    initializeThread,
    appendSystemMessage,
  } = threadOps ?? proxyDefaultThreadOps();

  const toolRouter = createToolRouter({
    tools,
    appendToolResult,
    threadId,
    hooks,
    subagents,
    skills,
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
    runSession: async ({
      stateManager,
    }): Promise<{
      finalMessage: M | null;
      exitReason: SessionExitReason;
      usage: ReturnType<typeof stateManager.getTotalUsage>;
    }> => {
      setHandler(
        defineUpdate<unknown, [MessageContent]>(`add${agentName}Message`),
        async (message: MessageContent) => {
          if (hooks.onPreHumanMessageAppend) {
            await hooks.onPreHumanMessageAppend({
              message,
              threadId,
            });
          }
          await appendHumanMessage(threadId, message);
          if (hooks.onPostHumanMessageAppend) {
            await hooks.onPostHumanMessageAppend({
              message,
              threadId,
            });
          }
          stateManager.run();
        }
      );

      if (hooks.onSessionStart) {
        await hooks.onSessionStart({
          threadId,
          agentName,
          metadata,
        });
      }

      const systemPrompt = stateManager.getSystemPrompt();

      if (!continueThread) {
        if (appendSystemPrompt) {
          if (!systemPrompt || systemPrompt.trim() === "") {
            throw ApplicationFailure.create({
              message: "No system prompt in state",
              nonRetryable: true,
            });
          }
          await appendSystemMessage(threadId, systemPrompt);
        } else {
          await initializeThread(threadId);
        }
      }
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

          stateManager.setTools(toolRouter.getToolDefinitions());

          const { message, rawToolCalls, usage } = await runAgent({
            threadId,
            agentName,
            metadata,
          });

          if (usage) {
            stateManager.updateUsage(usage);
          }

          // No tools configured - treat any non-end_turn as completed
          if (!toolRouter.hasTools() || rawToolCalls.length === 0) {
            stateManager.complete();
            exitReason = "completed";
            return {
              finalMessage: message,
              exitReason,
              usage: stateManager.getTotalUsage(),
            };
          }

          // Parse all tool calls uniformly through the router
          const parsedToolCalls: ParsedToolCallUnion<T>[] = [];
          for (const tc of rawToolCalls) {
            try {
              parsedToolCalls.push(toolRouter.parseToolCall(tc));
            } catch (error) {
              await appendToolResult({
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
          const toolCallResults = await toolRouter.processToolCalls(
            parsedToolCalls,
            {
              turn: currentTurn,
            }
          );

          for (const result of toolCallResults) {
            if (result.usage) {
              stateManager.updateUsage(result.usage);
            }
          }

          if (stateManager.getStatus() === "WAITING_FOR_INPUT") {
            const conditionMet = await condition(
              () => stateManager.getStatus() === "RUNNING",
              waitForInputTimeout
            );
            if (!conditionMet) {
              stateManager.cancel();
              // Wait briefly to allow pending waitForStateChange handlers to complete
              await condition(() => false, "2s");
              break;
            }
          }
        }

        // Check if we hit max turns
        if (stateManager.getTurns() >= maxTurns && stateManager.isRunning()) {
          exitReason = "max_turns";
        }
      } catch (error) {
        exitReason = "failed";
        throw ApplicationFailure.fromError(error);
      } finally {
        // SessionEnd hook - always called
        await callSessionEnd(exitReason, stateManager.getTurns());
      }

      return {
        finalMessage: null,
        exitReason,
        usage: stateManager.getTotalUsage(),
      };
    },
  };
};

/**
 * Proxy the adapter's thread operations as Temporal activities.
 * Call this in workflow code to delegate thread operations to the
 * adapter-provided activities registered on the worker.
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
): ThreadOps {
  return proxyActivities<ThreadOps>(
    options ?? {
      startToCloseTimeout: "10s",
      retry: {
        maximumAttempts: 6,
        initialInterval: "5s",
        maximumInterval: "15m",
        backoffCoefficient: 4,
      },
    }
  );
}
