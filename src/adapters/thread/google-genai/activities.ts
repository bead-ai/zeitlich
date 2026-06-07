import type { RedisClientType as Redis } from "redis";
import type {
  GoogleGenAI,
  Content,
  Part,
  GenerateContentConfig,
} from "@google/genai";
import type { ToolResultConfig } from "../../../lib/types";
import type { PersistedThreadState } from "../../../lib/state/types";
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
import { createTieredThreadManager } from "../../../lib/thread/tiered";
import type { ColdThreadStore } from "../../../lib/thread/cold-store";
import {
  createGoogleGenAIThreadManager,
  storedContentId,
  type GoogleGenAIContent,
  type GoogleGenAISystemContent,
  type GoogleGenAIThreadManagerHooks,
  type StoredContent,
} from "./thread-manager";
import {
  createGoogleGenAIModelInvoker,
  type GoogleGenAIModelInvokerConfig,
} from "./model-invoker";
import { ADAPTER_ID } from "./adapter-id";

export type GoogleGenAIThreadOps<TScope extends string = ""> =
  PrefixedThreadOps<
    ScopedPrefix<TScope, typeof ADAPTER_ID>,
    GoogleGenAIContent
  >;

export interface GoogleGenAIAdapterConfig {
  redis: Redis;
  client?: GoogleGenAI;
  /** Default model name (e.g. 'gemini-2.5-flash'). If omitted, use `createModelInvoker()` */
  model?: string;
  hooks?: GoogleGenAIThreadManagerHooks;
  /**
   * Optional durable cold tier (e.g. S3, R2, GCS). When provided,
   * the session hydrates the thread on entry (`continue`/`fork`) and
   * flushes it on every exit path. When omitted, the adapter is
   * Redis-only and `hydrateThread`/`flushThread` activities are no-ops.
   */
  coldStore?: ColdThreadStore;
  /**
   * Redis TTL for the thread's keys; defaults to 90 days. Use a shorter
   * value (hours) with a cold tier.
   */
  ttlSeconds?: number;
  /**
   * Default generation config forwarded to every invoker the adapter
   * builds (`invoker` and `createModelInvoker`). `systemInstruction`,
   * `tools`, and `abortSignal` are managed by the invoker and override
   * any values set here.
   */
  generationConfig?: GenerateContentConfig;
  /**
   * Default server-side context caching config forwarded to every
   * invoker the adapter builds. See {@link createGoogleGenAIModelInvoker}.
   */
  cache?: GoogleGenAIModelInvokerConfig["cache"];
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
 *       adapter.createModelInvoker('gemini-2.5-pro', client),
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

  // Single source for the adapter's `redis` handle and configured TTL, spread
  // into every internal thread manager so all of them share one configuration.
  const base = {
    redis,
    ...(config.ttlSeconds !== undefined && { ttlSeconds: config.ttlSeconds }),
  };

  const makeProviderThread = (threadId: string, threadKey?: string) =>
    createGoogleGenAIThreadManager({
      ...base,
      threadId,
      key: threadKey,
    });

  const makeTieredBase = (threadId: string, threadKey?: string) =>
    createTieredThreadManager<StoredContent>({
      ...base,
      threadId,
      key: threadKey,
      idOf: storedContentId,
      ...(config.coldStore && { coldStore: config.coldStore }),
    });

  const threadOps: ThreadOps<GoogleGenAIContent> = {
    async initializeThread(
      threadId: string,
      threadKey?: string
    ): Promise<void> {
      const thread = makeProviderThread(threadId, threadKey);
      await thread.initialize();
    },

    async appendHumanMessage(
      threadId: string,
      id: string,
      content: GoogleGenAIContent,
      threadKey?: string
    ): Promise<void> {
      const thread = makeProviderThread(threadId, threadKey);
      await thread.appendUserMessage(id, content);
    },

    async appendSystemMessage(
      threadId: string,
      id: string,
      content: GoogleGenAISystemContent,
      threadKey?: string
    ): Promise<void> {
      const thread = makeProviderThread(threadId, threadKey);
      await thread.appendSystemMessage(id, content);
    },

    async appendToolResult(id: string, cfg: ToolResultConfig): Promise<void> {
      const { threadId, threadKey, toolCallId, toolName, content } = cfg;
      const thread = makeProviderThread(threadId, threadKey);
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
      threadKey?: string
    ): Promise<void> {
      const thread = makeProviderThread(threadId, threadKey);
      await thread.appendModelContent(id, message.parts ?? []);
    },

    async forkThread(
      sourceThreadId: string,
      targetThreadId: string,
      threadKey?: string
    ): Promise<void> {
      const thread = createGoogleGenAIThreadManager({
        ...base,
        threadId: sourceThreadId,
        key: threadKey,
        hooks: config.hooks,
      });
      await thread.fork(targetThreadId);
    },

    async truncateThread(
      threadId: string,
      messageId: string,
      threadKey?: string,
    ): Promise<void> {
      const thread = makeProviderThread(threadId, threadKey);
      await thread.truncateFromId(messageId);
    },

    async loadThreadState(
      threadId: string,
      threadKey?: string
    ): Promise<PersistedThreadState | null> {
      const thread = makeProviderThread(threadId, threadKey);
      return thread.loadState();
    },

    async saveThreadState(
      threadId: string,
      state: PersistedThreadState,
      threadKey?: string
    ): Promise<void> {
      const thread = makeProviderThread(threadId, threadKey);
      await thread.saveState(state);
    },

    async hydrateThread(
      threadId: string,
      threadKey?: string
    ): Promise<void> {
      if (!config.coldStore) return;
      await makeTieredBase(threadId, threadKey).hydrate();
    },

    async flushThread(
      threadId: string,
      threadKey?: string
    ): Promise<void> {
      if (!config.coldStore) return;
      await makeTieredBase(threadId, threadKey).flush();
    },
  };

  function createActivities<S extends string = "">(
    scope?: S
  ): GoogleGenAIThreadOps<S> {
    const prefix = scope
      ? `${ADAPTER_ID}${scope.charAt(0).toUpperCase()}${scope.slice(1)}`
      : ADAPTER_ID;
    const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
    return Object.fromEntries(
      Object.entries(threadOps).map(([k, v]) => [`${prefix}${cap(k)}`, v])
    ) as GoogleGenAIThreadOps<S>;
  }

  const makeInvoker = (
    model: string,
    client: GoogleGenAI
  ): ModelInvoker<Content> =>
    createGoogleGenAIModelInvoker({
      ...base,
      client,
      model,
      hooks: config.hooks,
      ...(config.generationConfig !== undefined && {
        config: config.generationConfig,
      }),
      ...(config.cache !== undefined && { cache: config.cache }),
    });

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
