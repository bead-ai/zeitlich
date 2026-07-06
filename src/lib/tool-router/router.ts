import type {
  ToolMap,
  ToolDefinition,
  RouterContext,
  ToolHandler,
  RawToolCall,
  ParsedToolCallUnion,
  ParsedToolCall,
  ToolCallResult,
  ToolCallResultUnion,
  InferToolResults,
  ToolRouterOptions,
  ToolRouter,
  ToolNames,
  ToolArgs,
  ToolResult,
  ProcessToolCallsContext,
  ProcessToolCallsResult,
  RewindSignal,
  ToolWithHandler,
  PostToolUseFailureHookResult,
} from "./types";

import { normalizeHooks } from "../hooks/normalize";
import type { JsonValue } from "../state/types";
import type { z } from "zod";
import {
  uuid4,
  log,
  CancellationScope,
  isCancellation,
} from "@temporalio/workflow";

const MAX_CAUSE_DEPTH = 10;
const MAX_FAILURE_MESSAGE_LENGTH = 500;

/**
 * Extracts the most specific message from an error by walking its `cause`
 * chain (bounded, cycle-safe). Wrappers like Temporal's ChildWorkflowFailure
 * and ActivityFailure carry generic messages ("Activity task failed"); the
 * root cause at the bottom holds the actionable one. Returns the deepest
 * non-empty message, truncated to {@link MAX_FAILURE_MESSAGE_LENGTH} chars.
 */
function extractFailureMessage(error: unknown): string {
  const seen = new Set<unknown>();
  let deepest = "";
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth++) {
    if (current == null || seen.has(current)) break;
    seen.add(current);
    const maybeMessage = (current as { message?: unknown }).message;
    const message =
      current instanceof Error
        ? current.message
        : typeof maybeMessage === "string"
          ? maybeMessage
          : String(current);
    if (message.trim() !== "") deepest = message;
    current = (current as { cause?: unknown }).cause;
  }
  if (deepest === "") deepest = String(error);
  return deepest.length > MAX_FAILURE_MESSAGE_LENGTH
    ? `${deepest.slice(0, MAX_FAILURE_MESSAGE_LENGTH)}…`
    : deepest;
}

/**
 * Creates a tool router for declarative tool call processing.
 * Combines tool definitions with handlers in a single API.
 *
 * @example
 * ```typescript
 * const router = createToolRouter({
 *   threadId,
 *   tools: {
 *     Read: {
 *       name: "FileRead",
 *       description: "Read file contents",
 *       schema: z.object({ path: z.string() }),
 *       handler: async (args, ctx) => ({
 *         content: `Read ${args.path}`,
 *         result: { path: args.path, content: "..." },
 *       }),
 *     },
 *   },
 *   hooks: { onPreToolUse, onPostToolUse },
 * });
 *
 * // Parse raw tool calls from LLM
 * const parsed = router.parseToolCall(rawToolCall);
 *
 * // Process tool calls
 * const results = await router.processToolCalls([parsed]);
 * ```
 */
export function createToolRouter<T extends ToolMap>(
  options: ToolRouterOptions<T>
): ToolRouter<T> {
  const { appendToolResult } = options;
  type TResults = InferToolResults<T>;

  // Build internal lookup map by tool name
  const toolMap = new Map<string, ToolMap[string]>();
  for (const [_key, tool] of Object.entries(options.tools)) {
    toolMap.set(tool.name, tool as T[keyof T]);
  }

  const resolve = <T>(v: T | (() => T)): T =>
    typeof v === "function" ? (v as () => T)() : v;

  const isEnabled = (tool: ToolMap[string]): boolean =>
    resolve(tool.enabled) ?? true;

  if (options.plugins) {
    for (const plugin of options.plugins) {
      toolMap.set(plugin.name, plugin);
    }
  }

  /**
   * Run global → per-tool pre-hooks in order. The first `skip: true` stops
   * the chain; `modifiedArgs` are threaded into the next hook's args and
   * ultimately returned as the effective handler args.
   */
  async function runPreHooks(
    toolCall: ParsedToolCallUnion<T>,
    tool: ToolMap[string] | undefined,
    turn: number
  ): Promise<{ skip: true } | { skip: false; args: unknown }> {
    let effectiveArgs: unknown = toolCall.args;

    for (const hook of normalizeHooks(options.hooks?.onPreToolUse)) {
      const preResult = await hook({
        toolCall: {
          ...toolCall,
          args: effectiveArgs,
        } as ParsedToolCallUnion<T>,
        threadId: options.threadId,
        turn,
      });
      if (preResult?.skip) return { skip: true };
      if (preResult?.modifiedArgs !== undefined)
        effectiveArgs = preResult.modifiedArgs;
    }

    for (const hook of normalizeHooks(tool?.hooks?.onPreToolUse)) {
      const preResult = await hook({
        args: effectiveArgs,
        threadId: options.threadId,
        turn,
      });
      if (preResult?.skip) return { skip: true };
      if (preResult?.modifiedArgs !== undefined)
        effectiveArgs = preResult.modifiedArgs;
    }

    return { skip: false, args: effectiveArgs };
  }

  /**
   * Run global → per-tool failure hooks. All hooks run (so side-effect-only
   * hooks like observability always see the failure), then a single verdict
   * is derived:
   *
   * 1. any explicit `suppress: false` → rethrow the original error
   * 2. the last `fallbackContent` → recovered content (per-tool hooks run
   *    last, so the more specific recovery wins)
   * 3. any `suppress: true` → suppressed error content
   * 4. otherwise → default error content with the underlying failure reason
   */
  async function runFailureHooks(
    toolCall: ParsedToolCallUnion<T>,
    tool: ToolMap[string] | undefined,
    error: unknown,
    effectiveArgs: unknown,
    turn: number
  ): Promise<{ content: JsonValue; result: unknown }> {
    const err = error instanceof Error ? error : new Error(String(error));
    const errorStr = String(error);

    const results: PostToolUseFailureHookResult[] = [];
    for (const hook of normalizeHooks(options.hooks?.onPostToolUseFailure)) {
      const r = await hook({
        toolCall,
        error: err,
        threadId: options.threadId,
        turn,
      });
      if (r !== undefined) results.push(r);
    }
    for (const hook of normalizeHooks(tool?.hooks?.onPostToolUseFailure)) {
      const r = await hook({
        args: effectiveArgs,
        error: err,
        threadId: options.threadId,
        turn,
      });
      if (r !== undefined) results.push(r);
    }

    // An explicit `suppress: false` is the strongest signal: this error
    // must not be converted into model-visible content — let it bubble.
    if (results.some((r) => r.suppress === false)) throw error;

    for (let i = results.length - 1; i >= 0; i--) {
      const fallbackContent = results[i]?.fallbackContent;
      if (fallbackContent !== undefined)
        return {
          content: fallbackContent,
          result: { error: errorStr, recovered: true },
        };
    }

    if (results.some((r) => r.suppress))
      return {
        content: JSON.stringify({ error: errorStr, suppressed: true }),
        result: { error: errorStr, suppressed: true },
      };

    // No hook recovered: surface the underlying failure reason so the model
    // can act on it instead of guessing blind. Kept deliberately free of
    // behavioral instructions — consumers add those via onPostToolUseFailure.
    return {
      content: JSON.stringify({
        error: `Tool execution failed: ${extractFailureMessage(error)}`,
      }),
      result: { error: errorStr, suppressed: true },
    };
  }

  /** Run per-tool → global post-hooks sequentially; return values are ignored. */
  async function runPostHooks(
    toolCall: ParsedToolCallUnion<T>,
    tool: ToolMap[string] | undefined,
    toolResult: ToolCallResultUnion<TResults>,
    effectiveArgs: unknown,
    turn: number,
    durationMs: number
  ): Promise<void> {
    for (const hook of normalizeHooks(tool?.hooks?.onPostToolUse)) {
      await hook({
        args: effectiveArgs,
        result: toolResult.data,
        threadId: options.threadId,
        turn,
        durationMs,
        ...(toolResult.metadata && { metadata: toolResult.metadata }),
      });
    }
    for (const hook of normalizeHooks(options.hooks?.onPostToolUse)) {
      await hook({
        toolCall,
        result: toolResult,
        threadId: options.threadId,
        turn,
        durationMs,
      });
    }
  }

  /**
   * Internal per-tool-call outcome. `rewind` signals the caller that the
   * handler requested a session-level rewind; when present, the result is
   * not appended to the thread and siblings should be cancelled.
   */
  interface PendingAppend {
    toolCallId: string;
    toolName: string;
    content: JsonValue;
  }

  type ProcessedToolCall =
    | {
        kind: "result";
        value: ToolCallResultUnion<TResults>;
        pendingAppend?: PendingAppend;
      }
    | { kind: "rewind"; signal: RewindSignal }
    | { kind: "skipped"; pendingAppend?: PendingAppend };

  async function processToolCall(
    toolCall: ParsedToolCallUnion<T>,
    turn: number,
    sandboxId?: string,
    onRewindRequested?: (signal: RewindSignal) => void,
    assistantMessageId?: string,
    persistThreadState?: () => Promise<void>,
    deferAppend?: boolean,
    browserSessionId?: string
  ): Promise<ProcessedToolCall> {
    const startTime = Date.now();
    const tool = toolMap.get(toolCall.name);

    // --- Pre-hooks: may skip or modify args ---
    const preResult = await runPreHooks(toolCall, tool, turn);
    if (preResult.skip) {
      const skipContent = JSON.stringify({
        skipped: true,
        reason: "Skipped by PreToolUse hook",
      });
      if (deferAppend) {
        return {
          kind: "skipped",
          pendingAppend: {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: skipContent,
          },
        };
      }
      await appendToolResult(uuid4(), {
        threadId: options.threadId,
        threadKey: options.threadKey,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: skipContent,
      });
      return { kind: "skipped" };
    }
    const effectiveArgs = preResult.args;

    log.debug("tool call dispatched", {
      toolName: toolCall.name,
      toolCallId: toolCall.id,
      turn,
    });

    // --- Execute handler ---
    let result: unknown;
    let content!: JsonValue;
    let resultAppended = false;
    let metadata: Record<string, unknown> | undefined;
    let rewindRequested = false;

    try {
      if (tool) {
        const routerContext: RouterContext = {
          threadId: options.threadId,
          ...(options.threadKey && { threadKey: options.threadKey }),
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          ...(sandboxId !== undefined && { sandboxId }),
          ...(browserSessionId !== undefined && { browserSessionId }),
          ...(assistantMessageId !== undefined && { assistantMessageId }),
          ...(persistThreadState !== undefined && { persistThreadState }),
        };
        const response = await tool.handler(
          effectiveArgs as Parameters<typeof tool.handler>[0],
          routerContext as Parameters<typeof tool.handler>[1]
        );
        result = response.data;
        content = response.toolResponse as JsonValue;
        resultAppended = response.resultAppended === true;
        metadata = response.metadata;
        rewindRequested = response.rewind === true;
      } else {
        result = { error: `Unknown tool: ${toolCall.name}` };
        content = JSON.stringify(result, null, 2);
      }
    } catch (error) {
      if (isCancellation(error)) {
        throw error;
      }
      log.warn("tool call failed", {
        toolName: toolCall.name,
        toolCallId: toolCall.id,
        turn,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });
      const recovery = await runFailureHooks(
        toolCall,
        tool,
        error,
        effectiveArgs,
        turn
      );
      result = recovery.result;
      content = recovery.content;
    }

    if (rewindRequested) {
      const signal: RewindSignal = {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
      };
      log.info("tool requested rewind", { ...signal });
      onRewindRequested?.(signal);
      return { kind: "rewind", signal };
    }

    // --- Append result to thread (unless handler already did) ---
    const needsAppend = !resultAppended;
    if (needsAppend && !deferAppend) {
      await appendToolResult.executeWithOptions(
        {
          summary: `Append ${toolCall.name} result`,
        },
        [
          uuid4(),
          {
            threadId: options.threadId,
            threadKey: options.threadKey,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content,
          },
        ]
      );
    }

    const durationMs = Date.now() - startTime;

    const toolResult = {
      toolCallId: toolCall.id,
      name: toolCall.name,
      data: result,
      ...(metadata && { metadata }),
    } as ToolCallResultUnion<TResults>;

    log.debug("tool call completed", {
      toolName: toolCall.name,
      toolCallId: toolCall.id,
      turn,
      durationMs,
    });

    // --- Post-hooks ---
    await runPostHooks(
      toolCall,
      tool,
      toolResult,
      effectiveArgs,
      turn,
      durationMs
    );

    return {
      kind: "result",
      value: toolResult,
      ...(needsAppend &&
        deferAppend && {
          pendingAppend: {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content,
          },
        }),
    };
  }

  return {
    hasTools(): boolean {
      return Array.from(toolMap.values()).some(isEnabled);
    },

    parseToolCall(toolCall: RawToolCall): ParsedToolCallUnion<T> {
      const tool = toolMap.get(toolCall.name);

      if (!tool || !isEnabled(tool)) {
        throw new Error(`Tool ${toolCall.name} not found`);
      }

      const parsedArgs = resolve(tool.schema).parse(toolCall.args);

      return {
        id: toolCall.id ?? "",
        name: toolCall.name,
        args: parsedArgs,
      } as ParsedToolCallUnion<T>;
    },

    hasTool(name: string): boolean {
      const tool = toolMap.get(name);
      return tool !== undefined && isEnabled(tool);
    },

    getToolNames(): ToolNames<T>[] {
      return Array.from(toolMap.entries())
        .filter(([, tool]) => isEnabled(tool))
        .map(([name]) => name) as ToolNames<T>[];
    },

    getToolDefinitions(): ToolDefinition[] {
      return Array.from(toolMap)
        .filter(([, tool]) => isEnabled(tool))
        .map(([name, tool]) => ({
          name,
          description: resolve(tool.description),
          schema: resolve(tool.schema),
          strict: tool.strict,
          max_uses: tool.max_uses,
        }));
    },

    async processToolCalls(
      toolCalls: ParsedToolCallUnion<T>[],
      context?: ProcessToolCallsContext
    ): Promise<ProcessToolCallsResult<TResults>> {
      const attachRewind = (
        arr: ToolCallResultUnion<TResults>[],
        rewind: RewindSignal | undefined
      ): ProcessToolCallsResult<TResults> => {
        if (rewind) {
          (arr as ProcessToolCallsResult<TResults>).rewind = rewind;
        }
        return arr as ProcessToolCallsResult<TResults>;
      };

      if (toolCalls.length === 0) {
        return attachRewind([], undefined);
      }

      const turn = context?.turn ?? 0;
      const sandboxId = context?.sandboxId;
      const browserSessionId = context?.browserSessionId;
      const assistantMessageId = context?.assistantMessageId;
      const persistThreadState = context?.persistThreadState;

      let rewindSignal: RewindSignal | undefined;

      if (options.parallel) {
        const scope = new CancellationScope({ cancellable: true });
        const onRewindRequested = (signal: RewindSignal): void => {
          if (!rewindSignal) {
            rewindSignal = signal;
            // Cancel all other in-flight tool calls in this batch.
            scope.cancel();
          }
        };

        const outcomes = await scope.run(async () =>
          Promise.allSettled(
            toolCalls.map((tc) =>
              processToolCall(
                tc,
                turn,
                sandboxId,
                onRewindRequested,
                assistantMessageId,
                persistThreadState,
                true,
                browserSessionId
              )
            )
          )
        );

        // Fail fast on non-cancellation rejections before appending
        // anything, so the thread stays clean for retry/truncation.
        for (const outcome of outcomes) {
          if (
            outcome.status === "rejected" &&
            !isCancellation(outcome.reason)
          ) {
            throw outcome.reason;
          }
        }

        // Append deferred results in original call order so positional
        // correlation between function calls and responses is preserved.
        if (!rewindSignal) {
          for (const outcome of outcomes) {
            if (
              outcome.status === "fulfilled" &&
              outcome.value.kind !== "rewind" &&
              outcome.value.pendingAppend
            ) {
              const pa = outcome.value.pendingAppend;
              await appendToolResult.executeWithOptions(
                { summary: `Append ${pa.toolName} result` },
                [
                  uuid4(),
                  {
                    threadId: options.threadId,
                    threadKey: options.threadKey,
                    toolCallId: pa.toolCallId,
                    toolName: pa.toolName,
                    content: pa.content,
                  },
                ]
              );
            }
          }
        }

        const results: ToolCallResultUnion<TResults>[] = [];
        for (const outcome of outcomes) {
          if (outcome.status === "rejected") {
            continue;
          }
          if (outcome.value.kind === "result") {
            results.push(outcome.value.value);
          }
        }
        return attachRewind(results, rewindSignal);
      }

      const results: ToolCallResultUnion<TResults>[] = [];
      for (const toolCall of toolCalls) {
        const outcome = await processToolCall(
          toolCall,
          turn,
          sandboxId,
          undefined,
          assistantMessageId,
          persistThreadState,
          undefined,
          browserSessionId
        );
        if (outcome.kind === "rewind") {
          rewindSignal = outcome.signal;
          break;
        }
        if (outcome.kind === "result") {
          results.push(outcome.value);
        }
      }
      return attachRewind(results, rewindSignal);
    },

    async processToolCallsByName<TName extends ToolNames<T>, TResult>(
      toolCalls: ParsedToolCallUnion<T>[],
      toolName: TName,
      handler: ToolHandler<ToolArgs<T, TName>, TResult>,
      context?: ProcessToolCallsContext
    ): Promise<ToolCallResult<TName, TResult>[]> {
      const matchingCalls = toolCalls.filter((tc) => tc.name === toolName);

      if (matchingCalls.length === 0) {
        return [];
      }

      const processOne = async (
        toolCall: ParsedToolCallUnion<T>,
        deferAppend?: boolean
      ): Promise<{
        result: ToolCallResult<TName, TResult>;
        pendingAppend?: PendingAppend;
      }> => {
        const routerContext: RouterContext = {
          threadId: options.threadId,
          ...(options.threadKey && { threadKey: options.threadKey }),
          toolCallId: toolCall.id,
          toolName: toolCall.name as TName,
          ...(context?.sandboxId !== undefined && {
            sandboxId: context.sandboxId,
          }),
          ...(context?.browserSessionId !== undefined && {
            browserSessionId: context.browserSessionId,
          }),
          ...(context?.assistantMessageId !== undefined && {
            assistantMessageId: context.assistantMessageId,
          }),
          ...(context?.persistThreadState !== undefined && {
            persistThreadState: context.persistThreadState,
          }),
        };
        const response = await handler(
          toolCall.args as ToolArgs<T, TName>,
          routerContext as Parameters<typeof handler>[1]
        );

        const needsAppend = !response.resultAppended;
        if (needsAppend && !deferAppend) {
          await appendToolResult.executeWithOptions(
            {
              summary: `Append ${toolCall.name} result`,
            },
            [
              uuid4(),
              {
                threadId: options.threadId,
                threadKey: options.threadKey,
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                content: response.toolResponse as JsonValue,
              },
            ]
          );
        }

        return {
          result: {
            toolCallId: toolCall.id,
            name: toolCall.name as TName,
            data: response.data,
            ...(response.metadata && { metadata: response.metadata }),
          },
          ...(needsAppend &&
            deferAppend && {
              pendingAppend: {
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                content: response.toolResponse as JsonValue,
              },
            }),
        };
      };

      if (options.parallel) {
        const outcomes = await Promise.all(
          matchingCalls.map((tc) => processOne(tc, true))
        );
        for (const { pendingAppend } of outcomes) {
          if (pendingAppend) {
            await appendToolResult.executeWithOptions(
              { summary: `Append ${pendingAppend.toolName} result` },
              [
                uuid4(),
                {
                  threadId: options.threadId,
                  threadKey: options.threadKey,
                  toolCallId: pendingAppend.toolCallId,
                  toolName: pendingAppend.toolName,
                  content: pendingAppend.content,
                },
              ]
            );
          }
        }
        return outcomes.map((o) => o.result);
      }

      const results: ToolCallResult<TName, TResult>[] = [];
      for (const toolCall of matchingCalls) {
        const { result } = await processOne(toolCall);
        results.push(result);
      }
      return results;
    },

    filterByName<TName extends ToolNames<T>>(
      toolCalls: ParsedToolCallUnion<T>[],
      name: TName
    ): ParsedToolCall<TName, ToolArgs<T, TName>>[] {
      return toolCalls.filter(
        (tc): tc is ParsedToolCall<TName, ToolArgs<T, TName>> =>
          tc.name === name
      );
    },

    hasToolCall(
      toolCalls: ParsedToolCallUnion<T>[],
      name: ToolNames<T>
    ): boolean {
      return toolCalls.some((tc) => tc.name === name);
    },

    getResultsByName<TName extends ToolNames<T>>(
      results: ToolCallResultUnion<TResults>[],
      name: TName
    ): ToolCallResult<TName, ToolResult<T, TName>>[] {
      return results.filter((r) => r.name === name) as ToolCallResult<
        TName,
        ToolResult<T, TName>
      >[];
    },
  };
}

/**
 * Identity function that creates a generic inference context for a tool definition.
 * TypeScript infers TResult from the handler and flows it to hooks automatically.
 *
 * @example
 * ```typescript
 * tools: {
 *   AskUser: defineTool({
 *     ...askUserTool,
 *     handler: handleAskUser,
 *     hooks: {
 *       onPostToolUse: ({ result }) => {
 *         // result is correctly typed as the handler's return data type
 *       },
 *     },
 *   }),
 * }
 * ```
 */
export function defineTool<
  TName extends string,
  TSchema extends z.ZodType,
  TResult,
  TContext extends RouterContext = RouterContext,
  TToolResponse = JsonValue,
>(
  tool: ToolWithHandler<TName, TSchema, TResult, TContext, TToolResponse>
): ToolWithHandler<TName, TSchema, TResult, TContext, TToolResponse> {
  return tool;
}

/**
 * Utility to check if there were no tool calls besides a specific one
 */
export function hasNoOtherToolCalls<T extends ToolMap>(
  toolCalls: ParsedToolCallUnion<T>[],
  excludeName: ToolNames<T>
): boolean {
  return toolCalls.filter((tc) => tc.name !== excludeName).length === 0;
}
