import {
  proxyActivities,
  condition,
  defineUpdate,
  setHandler,
  ApplicationFailure,
  type ActivityInterfaceFor,
} from "@temporalio/workflow";
import type { SessionExitReason, MessageContent } from "../types";
import type { ThreadOps, SessionConfig, ZeitlichSession } from "./types";
import type { SandboxOps } from "../sandbox/types";
import { type AgentStateManager, type JsonSerializable } from "../state/types";
import { createToolRouter } from "../tool-router/router";
import type { ParsedToolCallUnion, ToolMap } from "../tool-router/types";
import { getShortId } from "../thread/id";
import { buildSubagentRegistration } from "../subagent/register";
import { buildSkillRegistration } from "../skills/register";

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
  sandbox: sandboxOps,
  sandboxId: inheritedSandboxId,
}: SessionConfig<T, M>): Promise<ZeitlichSession<M>> => {
  const sourceThreadId = continueThread ? providedThreadId : undefined;
  const threadId =
    continueThread && providedThreadId
      ? getShortId()
      : (providedThreadId ?? getShortId());

  const {
    appendToolResult,
    appendHumanMessage,
    initializeThread,
    appendSystemMessage,
    forkThread,
  } = threadOps ?? proxyDefaultThreadOps();

  const plugins: ToolMap[string][] = [];
  if (subagents) {
    const reg = buildSubagentRegistration(subagents);
    if (reg) plugins.push(reg);
  }
  if (skills) {
    const reg = buildSkillRegistration(skills);
    if (reg) plugins.push(reg);
  }

  const toolRouter = createToolRouter({
    tools,
    appendToolResult,
    threadId,
    hooks,
    plugins,
    parallel: processToolsInParallel,
  });

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
    runSession: async <TState extends JsonSerializable<TState>>({
      stateManager,
    }: {
      stateManager: AgentStateManager<TState>;
    }): Promise<{
      threadId: string;
      finalMessage: M | null;
      exitReason: SessionExitReason;
      usage: ReturnType<AgentStateManager<TState>["getTotalUsage"]>;
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

      // --- Sandbox lifecycle: create or inherit ---
      let sandboxId: string | undefined = inheritedSandboxId;
      const ownsSandbox = !sandboxId && !!sandboxOps;
      if (ownsSandbox) {
        const result = await sandboxOps.createSandbox({ id: threadId });
        sandboxId = result.sandboxId;
        if (result.stateUpdate) {
          stateManager.mergeUpdate(result.stateUpdate as Partial<TState>);
        }
      }

      if (hooks.onSessionStart) {
        await hooks.onSessionStart({
          threadId,
          agentName,
          metadata,
        });
      }

      const systemPrompt = stateManager.getSystemPrompt();

      if (continueThread && sourceThreadId) {
        await forkThread(sourceThreadId, threadId);
      } else {
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

          if (!toolRouter.hasTools() || rawToolCalls.length === 0) {
            stateManager.complete();
            exitReason = "completed";
            return {
              threadId,
              finalMessage: message,
              exitReason,
              usage: stateManager.getTotalUsage(),
            };
          }

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

          const toolCallResults = await toolRouter.processToolCalls(
            parsedToolCalls,
            {
              turn: currentTurn,
              ...(sandboxId !== undefined && { sandboxId }),
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
              exitReason = "cancelled";
              await condition(() => false, "2s");
              break;
            }
          }
        }

        if (stateManager.getTurns() >= maxTurns && stateManager.isRunning()) {
          exitReason = "max_turns";
        }
      } catch (error) {
        exitReason = "failed";
        throw ApplicationFailure.fromError(error);
      } finally {
        await callSessionEnd(exitReason, stateManager.getTurns());

        if (ownsSandbox && sandboxId && sandboxOps) {
          await sandboxOps.destroySandbox(sandboxId);
        }
      }

      return {
        threadId,
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
): ActivityInterfaceFor<ThreadOps> {
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

/**
 * Proxy sandbox lifecycle operations as Temporal activities.
 * Call this in workflow code when the agent needs a sandbox.
 *
 * @example
 * ```typescript
 * const session = await createSession({
 *   sandbox: proxySandboxOps(),
 *   // ...
 * });
 * ```
 */
export function proxySandboxOps(
  options?: Parameters<typeof proxyActivities>[0]
): SandboxOps {
  return proxyActivities<SandboxOps>(
    options ?? {
      startToCloseTimeout: "30s",
      retry: {
        maximumAttempts: 3,
        initialInterval: "2s",
        maximumInterval: "30s",
        backoffCoefficient: 2,
      },
    }
  );
}
