import {
  condition,
  defineUpdate,
  setHandler,
  ApplicationFailure,
} from "@temporalio/workflow";
import type { SessionExitReason, MessageContent } from "../types";
import type { SessionConfig, ZeitlichSession } from "./types";
import { type AgentStateManager, type JsonSerializable } from "../state/types";
import { createToolRouter } from "../tool-router/router";
import type { ParsedToolCallUnion, ToolMap } from "../tool-router/types";
import { getShortId } from "../thread/id";
import { buildSubagentRegistration } from "../subagent/register";
import { buildSkillRegistration } from "../skills/register";
import { uuid4 } from "@temporalio/workflow";

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
 * import { proxyGoogleGenAIThreadOps } from 'zeitlich/adapters/thread/google-genai/workflow';
 *
 * const session = await createSession({
 *   agentName: "my-agent",
 *   maxTurns: 20,
 *   threadId: runId,
 *   threadOps: proxyGoogleGenAIThreadOps(), // auto-scoped to current workflow
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
  sandboxOps,
  sandboxId: inheritedSandboxId,
  previousSandboxId,
  sandboxOnExit = "destroy",
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
  } = threadOps;

  const plugins: ToolMap[string][] = [];
  let destroySubagentSandboxes: (() => Promise<void>) | undefined;
  if (subagents) {
    const result = buildSubagentRegistration(subagents);
    if (result) {
      plugins.push(result.registration);
      destroySubagentSandboxes = result.destroySubagentSandboxes;
    }
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
      sandboxId?: string;
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
          await appendHumanMessage(threadId, uuid4(), message);
          if (hooks.onPostHumanMessageAppend) {
            await hooks.onPostHumanMessageAppend({
              message,
              threadId,
            });
          }
          stateManager.run();
        }
      );

      // --- Sandbox lifecycle: create, fork, or inherit ---
      let sandboxId: string | undefined = inheritedSandboxId;
      const isInherited = !!inheritedSandboxId && !previousSandboxId;

      if (previousSandboxId && !sandboxOps) {
        throw ApplicationFailure.create({
          message:
            "No sandboxOps provided — cannot fork from previousSandboxId",
          nonRetryable: true,
        });
      }

      if (sandboxId && previousSandboxId) {
        throw ApplicationFailure.create({
          message:
            "Both sandboxId and previousSandboxId provided — cannot manage sandbox lifecycle",
          nonRetryable: true,
        });
      }

      if (sandboxId && !sandboxOps) {
        throw ApplicationFailure.create({
          message:
            "sandboxId provided but no sandboxOps — cannot manage sandbox lifecycle",
          nonRetryable: true,
        });
      }

      if (sandboxOps) {
        if (previousSandboxId) {
          sandboxId = await sandboxOps.forkSandbox(previousSandboxId);
        } else if (!sandboxId) {
          const result = await sandboxOps.createSandbox();
          sandboxId = result.sandboxId;
          if (result.stateUpdate) {
            stateManager.mergeUpdate(result.stateUpdate as Partial<TState>);
          }
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
          await appendSystemMessage(threadId, uuid4(), systemPrompt);
        } else {
          await initializeThread(threadId);
        }
      }
      await appendHumanMessage(threadId, uuid4(), await buildContextMessage());

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
              ...(sandboxId && { sandboxId }),
            };
          }

          const parsedToolCalls: ParsedToolCallUnion<T>[] = [];
          for (const tc of rawToolCalls) {
            try {
              parsedToolCalls.push(toolRouter.parseToolCall(tc));
            } catch (error) {
              await appendToolResult(uuid4(), {
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

        if (!isInherited && sandboxId && sandboxOps) {
          if (sandboxOnExit === "destroy") {
            await sandboxOps.destroySandbox(sandboxId);
          } else if (
            sandboxOnExit === "pause" ||
            sandboxOnExit === "pause-until-parent-close"
          ) {
            await sandboxOps.pauseSandbox(sandboxId);
          }
        }

        if (destroySubagentSandboxes) {
          await destroySubagentSandboxes();
        }
      }

      return {
        threadId,
        finalMessage: null,
        exitReason,
        usage: stateManager.getTotalUsage(),
        ...(sandboxId && { sandboxId }),
      };
    },
  };
};
