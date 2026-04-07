import type Redis from "ioredis";
import type { GoogleGenAI, Content, Part } from "@google/genai";
import type { ToolResultConfig } from "../../../lib/types";
import type {
  ActivityToolHandler,
  RouterContext,
  ToolHandlerResponse,
} from "../../../lib/tool-router/types";
import type {
  ThreadOps,
  PrefixedThreadOps,
  ScopedPrefix,
} from "../../../lib/session/types";
import type { ModelInvoker } from "../../../lib/model";
import {
  createGoogleGenAIThreadManager,
  type GoogleGenAIContent,
  type GoogleGenAIThreadManagerHooks,
} from "./thread-manager";
import { createGoogleGenAIModelInvoker } from "./model-invoker";

const ADAPTER_PREFIX = "googleGenAI" as const;

export type GoogleGenAIThreadOps<TScope extends string = ""> =
  PrefixedThreadOps<
    ScopedPrefix<TScope, typeof ADAPTER_PREFIX>,
    GoogleGenAIContent
  >;

export interface GoogleGenAIAdapterConfig {
  redis: Redis;
  client?: GoogleGenAI;
  /** Default model name (e.g. 'gemini-2.5-flash'). If omitted, use `createModelInvoker()` */
  model?: string;
  hooks?: GoogleGenAIThreadManagerHooks;
}

/**
 * Tool response type accepted by the Google GenAI adapter.
 *
 * Handlers can return:
 * - **`string`** — plain text, wrapped in a `functionResponse` part.
 * - **`Record<string, unknown>`** — structured object used as `functionResponse.response`.
 * - **`Part[]`** — pre-built parts used directly as `Content.parts`.
 *   The handler is responsible for building correct Part objects (e.g. `functionResponse`,
 *   `inlineData`, `text`). Use `context.toolCallId` and `context.toolName` to construct
 *   `functionResponse` parts.
 *
 * @example
 * ```typescript
 * adapter.wrapHandler(async (args, ctx) => ({
 *   toolResponse: [
 *     { functionResponse: { id: ctx.toolCallId, name: ctx.toolName, response: { result: "done" } } },
 *     { inlineData: { data: base64, mimeType: "image/png" } },
 *   ],
 *   data: null,
 * }));
 * ```
 */
export type GoogleGenAIToolResponse = string | Record<string, unknown> | Part[];

export interface GoogleGenAIAdapter {
  /** Model invoker using the default model (only available when `model` was provided) */
  invoker: ModelInvoker<Content>;
  /** Create an invoker for a specific model name (for multi-model setups) */
  createModelInvoker(model: string, client: GoogleGenAI): ModelInvoker<Content>;
  /**
   * Create prefixed thread activities for registration on the worker.
   *
   * @param scope - Workflow name appended to the adapter prefix.
   *   Use different scopes for the main agent vs subagents to avoid collisions.
   *
   * @example
   * ```typescript
   * adapter.createActivities("codingAgent")
   * // → { googleGenAICodingAgentInitializeThread, googleGenAICodingAgentAppendHumanMessage, … }
   *
   * adapter.createActivities("researchAgent")
   * // → { googleGenAIResearchAgentInitializeThread, … }
   * ```
   */
  createActivities<S extends string = "">(scope?: S): GoogleGenAIThreadOps<S>;

  /**
   * Identity wrapper that types a tool handler for this adapter.
   * Constrains `toolResponse` to {@link GoogleGenAIToolResponse}.
   */
  wrapHandler<TArgs, TResult, TContext extends RouterContext = RouterContext>(
    handler: (
      args: TArgs,
      context: TContext
    ) => Promise<ToolHandlerResponse<TResult, GoogleGenAIToolResponse>>
  ): ActivityToolHandler<TArgs, TResult, TContext, GoogleGenAIToolResponse>;
}

/**
 * Creates a Google GenAI adapter that bundles thread operations and model
 * invocation using the `@google/genai` SDK.
 *
 * Use `createActivities(scope)` to register scoped thread operations as
 * Temporal activities on the worker. The `invoker` (or invokers created via
 * `createModelInvoker`) should be wrapped with `createRunAgentActivity`.
 *
 * @example
 * ```typescript
 * import { createGoogleGenAIAdapter } from 'zeitlich/adapters/thread/google-genai';
 * import { createRunAgentActivity } from 'zeitlich';
 * import { GoogleGenAI } from '@google/genai';
 *
 * const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
 * const adapter = createGoogleGenAIAdapter({ redis, client, model: 'gemini-2.5-flash' });
 *
 * export function createActivities(temporalClient: WorkflowClient) {
 *   return {
 *     ...adapter.createActivities("codingAgent"),
 *     ...createRunAgentActivity(temporalClient, adapter.invoker, "codingAgent"),
 *   };
 * }
 * ```
 *
 * @example Multi-agent worker (main + subagent share the adapter)
 * ```typescript
 * export function createActivities(temporalClient: WorkflowClient) {
 *   return {
 *     ...adapter.createActivities("codingAgent"),
 *     ...adapter.createActivities("researchAgent"),
 *     ...createRunAgentActivity(temporalClient, adapter.invoker, "codingAgent"),
 *     ...createRunAgentActivity(
 *       temporalClient,
 *       adapter.createModelInvoker('gemini-2.5-pro'),
 *       "researchAgent",
 *     ),
 *   };
 * }
 * ```
 */
export function createGoogleGenAIAdapter(
  config: GoogleGenAIAdapterConfig
): GoogleGenAIAdapter {
  const { redis } = config;

  const threadOps: ThreadOps<GoogleGenAIContent> = {
    async initializeThread(
      threadId: string,
      threadKey?: string
    ): Promise<void> {
      const thread = createGoogleGenAIThreadManager({
        redis,
        threadId,
        key: threadKey,
      });
      await thread.initialize();
    },

    async appendHumanMessage(
      threadId: string,
      id: string,
      content: GoogleGenAIContent,
      threadKey?: string
    ): Promise<void> {
      const thread = createGoogleGenAIThreadManager({
        redis,
        threadId,
        key: threadKey,
      });
      await thread.appendUserMessage(id, content);
    },

    async appendSystemMessage(
      threadId: string,
      id: string,
      content: string,
      threadKey?: string
    ): Promise<void> {
      const thread = createGoogleGenAIThreadManager({
        redis,
        threadId,
        key: threadKey,
      });
      await thread.appendSystemMessage(id, content);
    },

    async appendToolResult(id: string, cfg: ToolResultConfig): Promise<void> {
      const { threadId, threadKey, toolCallId, toolName, content } = cfg;
      const thread = createGoogleGenAIThreadManager({
        redis,
        threadId,
        key: threadKey,
      });
      await thread.appendToolResult(
        id,
        toolCallId,
        toolName,
        content as GoogleGenAIToolResponse
      );
    },

    async appendAgentMessage(
      threadId: string,
      id: string,
      message: Content,
      threadKey?: string,
    ): Promise<void> {
      const thread = createGoogleGenAIThreadManager({
        redis,
        threadId,
        key: threadKey,
      });
      await thread.appendModelContent(id, message.parts ?? []);
    },

    async forkThread(
      sourceThreadId: string,
      targetThreadId: string,
      threadKey?: string
    ): Promise<void> {
      const thread = createGoogleGenAIThreadManager({
        redis,
        threadId: sourceThreadId,
        key: threadKey,
      });
      await thread.fork(targetThreadId);
    },
  };

  function createActivities<S extends string = "">(
    scope?: S
  ): GoogleGenAIThreadOps<S> {
    const prefix = scope
      ? `${ADAPTER_PREFIX}${scope.charAt(0).toUpperCase()}${scope.slice(1)}`
      : ADAPTER_PREFIX;
    const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
    return Object.fromEntries(
      Object.entries(threadOps).map(([k, v]) => [`${prefix}${cap(k)}`, v])
    ) as GoogleGenAIThreadOps<S>;
  }

  const makeInvoker = (
    model: string,
    client: GoogleGenAI
  ): ModelInvoker<Content> =>
    createGoogleGenAIModelInvoker({ redis, client, model, hooks: config.hooks });

  const invoker: ModelInvoker<Content> =
    config.model && config.client
      ? makeInvoker(config.model, config.client)
      : ((() => {
          throw new Error(
            "No default model provided to createGoogleGenAIAdapter. " +
              "Either pass `model` in the config or use `createModelInvoker(model)` instead."
          );
        }) as unknown as ModelInvoker<Content>);

  return {
    createActivities,
    invoker,
    createModelInvoker: makeInvoker,
    wrapHandler: (handler) => handler,
  };
}
