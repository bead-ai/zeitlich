import {
  condition,
  defineUpdate,
  setHandler,
  ApplicationFailure,
  log,
} from "@temporalio/workflow";
import type { SessionExitReason } from "../types";
import type { SessionConfig, ZeitlichSession } from "./types";
import type {
  SandboxCreateOptions,
  SandboxOps,
  SandboxSnapshot,
} from "../sandbox/types";
import type {
  AgentState,
  AgentStateManager,
  JsonSerializable,
} from "../state/types";
import { createToolRouter } from "../tool-router/router";
import type { ParsedToolCallUnion, ToolMap } from "../tool-router/types";
import { getShortId } from "../thread/id";
import { buildSubagentRegistration } from "../subagent/register";
import { buildSkillRegistration } from "../skills/register";
import type { Skill } from "../skills/types";
import { uuid4 } from "@temporalio/workflow";

/**
 * Collects resource file contents from all skills into a flat map
 * keyed by absolute path (location + relative resource path).
 * Returns undefined when no skills carry resource contents.
 */
function collectSkillFiles(
  skills: Skill[]
): Record<string, string> | undefined {
  let files: Record<string, string> | undefined;
  for (const skill of skills) {
    if (!skill.resourceContents || !skill.location) continue;
    for (const [relPath, content] of Object.entries(skill.resourceContents)) {
      files ??= {};
      files[`${skill.location}/${relPath}`] = content;
    }
  }
  return files;
}

/**
 * Creates an agent session that manages the agent loop: LLM invocation,
 * tool routing, subagent coordination, and lifecycle hooks.
 *
 * When `sandboxOps` is provided the returned session result is guaranteed to
 * include `sandboxId: string`. Without it, `sandboxId` is `undefined`.
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
 *   thread: { mode: "new" },
 *   threadOps: proxyGoogleGenAIThreadOps(),
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
export async function createSession<
  T extends ToolMap,
  M = unknown,
  TContent = string,
>(
  config: SessionConfig<T, M, TContent> & { sandboxOps: SandboxOps }
): Promise<ZeitlichSession<M, true>>;
export async function createSession<
  T extends ToolMap,
  M = unknown,
  TContent = string,
>(config: SessionConfig<T, M, TContent>): Promise<ZeitlichSession<M, false>>;
export async function createSession<
  T extends ToolMap,
  M = unknown,
  TContent = string,
>({
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
  waitForInputTimeout = "48h",
  threadKey,
  sandboxOps,
  thread: threadInit,
  sandbox: sandboxInit,
  sandboxShutdown = "destroy",
  onSandboxReady,
  virtualFs: virtualFsConfig,
  virtualFsOps,
}: SessionConfig<T, M, TContent>): Promise<ZeitlichSession<M, boolean>> {
  // ---------------------------------------------------------------------------
  // Thread resolution
  // ---------------------------------------------------------------------------
  const threadMode = threadInit?.mode ?? "new";
  let threadId: string;
  let sourceThreadId: string | undefined;

  switch (threadMode) {
    case "new":
      threadId =
        threadInit?.mode === "new" && threadInit.threadId
          ? threadInit.threadId
          : getShortId();
      break;
    case "continue":
      threadId = (threadInit as { mode: "continue"; threadId: string })
        .threadId;
      break;
    case "fork":
      sourceThreadId = (threadInit as { mode: "fork"; threadId: string })
        .threadId;
      threadId = getShortId();
      break;
  }

  const {
    appendToolResult,
    appendHumanMessage,
    initializeThread,
    appendSystemMessage,
    appendAgentMessage,
    forkThread,
  } = threadOps;

  const plugins: ToolMap[string][] = [];
  let destroySubagentSandboxes: (() => Promise<void>) | undefined;
  let cleanupSubagentSnapshots: (() => Promise<void>) | undefined;

  if (subagents) {
    const result = buildSubagentRegistration(subagents);
    if (result) {
      plugins.push(result.registration);
      destroySubagentSandboxes = result.destroySubagentSandboxes;
      cleanupSubagentSnapshots = result.cleanupSubagentSnapshots;
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
    threadKey,
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
    }) => {
      setHandler(
        defineUpdate<unknown, [TContent]>(`add${agentName}Message`),
        async (message: TContent) => {
          if (hooks.onPreHumanMessageAppend) {
            await hooks.onPreHumanMessageAppend({
              message,
              threadId,
            });
          }
          await appendHumanMessage(threadId, uuid4(), message, threadKey);
          if (hooks.onPostHumanMessageAppend) {
            await hooks.onPostHumanMessageAppend({
              message,
              threadId,
            });
          }
          stateManager.run();
        }
      );

      // --- Sandbox lifecycle: create, continue, fork, from-snapshot, or inherit ---
      const sandboxMode = sandboxInit?.mode;
      let sandboxId: string | undefined;
      let sandboxOwned = false;
      let baseSnapshot: SandboxSnapshot | undefined;
      let exitSnapshot: SandboxSnapshot | undefined;
      let freshlyCreated = false;

      if (sandboxMode === "inherit") {
        const inheritInit = sandboxInit as {
          mode: "inherit";
          sandboxId: string;
        };
        sandboxId = inheritInit.sandboxId;
        if (!sandboxOps) {
          throw ApplicationFailure.create({
            message:
              "sandboxId provided but no sandboxOps — cannot manage sandbox lifecycle",
            nonRetryable: true,
          });
        }
      } else if (sandboxMode === "continue") {
        if (!sandboxOps) {
          throw ApplicationFailure.create({
            message: "No sandboxOps provided — cannot continue sandbox",
            nonRetryable: true,
          });
        }
        sandboxId = (sandboxInit as { mode: "continue"; sandboxId: string })
          .sandboxId;
        if (sandboxShutdown === "pause-until-parent-close") {
          await sandboxOps.resumeSandbox(sandboxId);
        }
        sandboxOwned = true;
      } else if (sandboxMode === "fork") {
        if (!sandboxOps) {
          throw ApplicationFailure.create({
            message: "No sandboxOps provided — cannot fork sandbox",
            nonRetryable: true,
          });
        }
        const forkInit = sandboxInit as {
          mode: "fork";
          sandboxId: string;
          options?: SandboxCreateOptions;
        };
        sandboxId = await sandboxOps.forkSandbox(
          forkInit.sandboxId,
          forkInit.options
        );
        sandboxOwned = true;
      } else if (sandboxMode === "from-snapshot") {
        if (!sandboxOps) {
          throw ApplicationFailure.create({
            message: "No sandboxOps provided — cannot restore sandbox",
            nonRetryable: true,
          });
        }
        const restoreInit = sandboxInit as {
          mode: "from-snapshot";
          snapshot: SandboxSnapshot;
          options?: SandboxCreateOptions;
        };
        sandboxId = await sandboxOps.restoreSandbox(
          restoreInit.snapshot,
          restoreInit.options
        );
        sandboxOwned = true;
      } else if (sandboxOps) {
        const skillFiles = skills ? collectSkillFiles(skills) : undefined;
        const ctx = (sandboxInit as { mode: "new"; ctx?: unknown } | undefined)
          ?.ctx;
        const createOptions = skillFiles
          ? { initialFiles: skillFiles }
          : undefined;
        const result = await sandboxOps.createSandbox(createOptions, ctx);
        if (result) {
          sandboxId = result.sandboxId;
          sandboxOwned = true;
          freshlyCreated = true;
        }
      }

      // Capture a base snapshot immediately after seeding so it can be reused
      // as a template for future runs that want to skip the (potentially
      // expensive) seed step.
      if (
        sandboxId &&
        sandboxOwned &&
        freshlyCreated &&
        sandboxShutdown === "snapshot" &&
        sandboxOps
      ) {
        baseSnapshot = await sandboxOps.snapshotSandbox(sandboxId);
      }

      if (sandboxId && sandboxOwned && onSandboxReady) {
        onSandboxReady(sandboxId);
      }

      // --- Virtual filesystem init (independent of sandbox) ----------------
      if (virtualFsConfig) {
        if (!virtualFsOps) {
          throw ApplicationFailure.create({
            message: "No virtualFsOps provided — cannot resolve file tree",
            nonRetryable: true,
          });
        }
        const result = await virtualFsOps.resolveFileTree(virtualFsConfig.ctx);
        const skillFiles = skills ? collectSkillFiles(skills) : undefined;
        const fileTree = skillFiles
          ? [
              ...result.fileTree,
              ...Object.entries(skillFiles).map(([path, content]) => ({
                id: `skill:${path}`,
                path,
                size: content.length,
                mtime: new Date().toISOString(),
                metadata: {},
              })),
            ]
          : result.fileTree;
        stateManager.mergeUpdate({
          fileTree,
          virtualFsCtx: virtualFsConfig.ctx,
          ...(skillFiles && { inlineFiles: skillFiles }),
        } as Partial<AgentState<TState>>);
      }

      if (hooks.onSessionStart) {
        await hooks.onSessionStart({
          threadId,
          agentName,
          metadata,
        });
      }

      log.info("session started", {
        agentName,
        threadId,
        threadMode,
        maxTurns,
        ...(sandboxId && { sandboxId }),
      });

      const sessionStartMs = Date.now();
      const systemPrompt = stateManager.getSystemPrompt();

      // --- Thread lifecycle: new, continue, or fork ----------------------
      if (threadMode === "fork" && sourceThreadId) {
        const transform =
          (threadInit as { mode: "fork"; transform?: boolean }).transform ===
          true;
        await forkThread(sourceThreadId, threadId, threadKey, { transform });
      } else if (threadMode === "continue") {
        // "continue" — thread already exists, just append the new message
      } else {
        if (appendSystemPrompt) {
          if (
            systemPrompt == null ||
            (typeof systemPrompt === "string" && systemPrompt.trim() === "")
          ) {
            throw ApplicationFailure.create({
              message: "No system prompt in state",
              nonRetryable: true,
            });
          }
          await appendSystemMessage(threadId, uuid4(), systemPrompt, threadKey);
        } else {
          await initializeThread(threadId, threadKey);
        }
      }
      await appendHumanMessage(
        threadId,
        uuid4(),
        await buildContextMessage(),
        threadKey
      );

      let exitReason: SessionExitReason = "completed";
      let finalMessage: M | null = null;

      try {
        // Per-turn assistant message id. Pre-generated in the workflow
        // so the runAgent activity can truncate the thread from this id
        // on entry (deterministic rewind + time-travel via Temporal
        // workflow reset). On a rewind retry we keep the same id so the
        // prior attempt's assistant + tool results are wiped by the next
        // runAgent call.
        let assistantId: string | undefined;
        while (
          stateManager.isRunning() &&
          !stateManager.isTerminal() &&
          stateManager.getTurns() < maxTurns
        ) {
          stateManager.incrementTurns();
          const currentTurn = stateManager.getTurns();

          log.debug("turn started", { agentName, threadId, turn: currentTurn });

          stateManager.setTools(toolRouter.getToolDefinitions());

          assistantId ??= uuid4();

          const { message, rawToolCalls, usage } = await runAgent({
            threadId,
            threadKey,
            agentName,
            metadata,
            assistantMessageId: assistantId,
          });

          await appendAgentMessage(threadId, assistantId, message, threadKey);

          if (usage) {
            stateManager.updateUsage(usage);
          }

          log.debug("model response received", {
            agentName,
            threadId,
            turn: currentTurn,
            toolCallCount: rawToolCalls.length,
            ...(usage && { usage }),
          });

          if (!toolRouter.hasTools() || rawToolCalls.length === 0) {
            stateManager.complete();
            exitReason = "completed";
            finalMessage = message;
            break;
          }

          const parsedToolCalls: ParsedToolCallUnion<T>[] = [];
          for (const tc of rawToolCalls) {
            try {
              parsedToolCalls.push(toolRouter.parseToolCall(tc));
            } catch (error) {
              await appendToolResult(uuid4(), {
                threadId,
                threadKey,
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

          const rewind = toolCallResults.rewind;
          if (rewind) {
            log.info("rewinding turn", {
              agentName,
              threadId,
              turn: currentTurn,
              toolCallId: rewind.toolCallId,
              toolName: rewind.toolName,
            });
            // Keep the same assistantId for the retry. The next
            // runAgent call will call truncateFromId(assistantId) on
            // entry, wiping the bad assistant message + any already
            // appended tool results before re-invoking the LLM. The
            // turn counter is intentionally NOT rolled back — each
            // rewind still consumes one of the `maxTurns` budget so a
            // misbehaving tool cannot spin the session forever.
            continue;
          }

          // Turn committed: fresh id for the next turn.
          assistantId = undefined;

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
          log.warn("session hit max turns", {
            agentName,
            threadId,
            maxTurns,
          });
        }
      } catch (error) {
        exitReason = "failed";
        log.error("session failed", {
          agentName,
          threadId,
          turns: stateManager.getTurns(),
          durationMs: Date.now() - sessionStartMs,
          error: error instanceof Error ? error.message : String(error),
        });
        throw ApplicationFailure.fromError(error);
      } finally {
        await callSessionEnd(exitReason, stateManager.getTurns());

        if (sandboxOwned && sandboxId && sandboxOps) {
          switch (sandboxShutdown) {
            case "destroy":
              await sandboxOps.destroySandbox(sandboxId);
              break;
            case "pause":
            case "pause-until-parent-close":
              await sandboxOps.pauseSandbox(sandboxId);
              break;
            case "keep":
            case "keep-until-parent-close":
              break;
            case "snapshot":
              exitSnapshot = await sandboxOps.snapshotSandbox(sandboxId);
              await sandboxOps.destroySandbox(sandboxId);
              break;
          }
        }

        if (destroySubagentSandboxes) {
          await destroySubagentSandboxes();
        }

        if (cleanupSubagentSnapshots) {
          await cleanupSubagentSnapshots();
        }
      }

      log.info("session ended", {
        agentName,
        threadId,
        exitReason,
        turns: stateManager.getTurns(),
        durationMs: Date.now() - sessionStartMs,
        usage: stateManager.getTotalUsage(),
        ...(baseSnapshot && { hasBaseSnapshot: true }),
        ...(exitSnapshot && { hasExitSnapshot: true }),
      });

      return {
        threadId,
        finalMessage,
        exitReason,
        usage: stateManager.getTotalUsage(),
        sandboxId,
        ...(baseSnapshot && { baseSnapshot }),
        ...(exitSnapshot && { snapshot: exitSnapshot }),
      } as Awaited<ReturnType<ZeitlichSession<M, boolean>["runSession"]>>;
    },
  };
}
