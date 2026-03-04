import type Redis from "ioredis";
import type { GoogleGenAI, Content } from "@google/genai";
import type { ThreadOps, ToolResultConfig } from "../../lib/types";
import type { MessageContent } from "../../lib/types";
import type { ModelInvoker } from "../../lib/model-invoker";
import { createGoogleGenAIThreadManager } from "./thread-manager";
import { createGoogleGenAIModelInvoker } from "./model-invoker";

export interface GoogleGenAIAdapterConfig {
  redis: Redis;
  client: GoogleGenAI;
  /** Default model name (e.g. 'gemini-2.5-flash'). If omitted, use `createModelInvoker()` */
  model?: string;
}

export interface GoogleGenAIAdapter {
  /** Thread operations (register these as Temporal activities on the worker) */
  threadOps: ThreadOps;
  /** Model invoker using the default model (only available when `model` was provided) */
  invoker: ModelInvoker<Content>;
  /** Create an invoker for a specific model name (for multi-model setups) */
  createModelInvoker(model: string): ModelInvoker<Content>;
}

/**
 * Creates a Google GenAI adapter that bundles thread operations and model
 * invocation using the `@google/genai` SDK.
 *
 * The returned `threadOps` should be registered as Temporal activities on
 * the worker. The `invoker` (or invokers created via `createModelInvoker`)
 * should be wrapped with `createRunAgentActivity` for per-agent activities.
 *
 * @example
 * ```typescript
 * import { createGoogleGenAIAdapter } from 'zeitlich/adapters/google-genai';
 * import { createRunAgentActivity } from 'zeitlich';
 * import { GoogleGenAI } from '@google/genai';
 *
 * const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
 * const adapter = createGoogleGenAIAdapter({ redis, client, model: 'gemini-2.5-flash' });
 *
 * export function createActivities(temporalClient: WorkflowClient) {
 *   return {
 *     ...adapter.threadOps,
 *     runAgent: createRunAgentActivity(temporalClient, adapter.invoker),
 *   };
 * }
 * ```
 *
 * @example Multi-model setup
 * ```typescript
 * const adapter = createGoogleGenAIAdapter({ redis, client });
 *
 * export function createActivities(temporalClient: WorkflowClient) {
 *   return {
 *     ...adapter.threadOps,
 *     runResearchAgent: createRunAgentActivity(
 *       temporalClient,
 *       adapter.createModelInvoker('gemini-2.5-pro'),
 *     ),
 *     runFastAgent: createRunAgentActivity(
 *       temporalClient,
 *       adapter.createModelInvoker('gemini-2.5-flash'),
 *     ),
 *   };
 * }
 * ```
 */
export function createGoogleGenAIAdapter(
  config: GoogleGenAIAdapterConfig,
): GoogleGenAIAdapter {
  const { redis, client } = config;

  const threadOps: ThreadOps = {
    async initializeThread(threadId: string): Promise<void> {
      const thread = createGoogleGenAIThreadManager({ redis, threadId });
      await thread.initialize();
    },

    async appendHumanMessage(
      threadId: string,
      content: string | MessageContent,
    ): Promise<void> {
      const thread = createGoogleGenAIThreadManager({ redis, threadId });
      await thread.appendUserMessage(content);
    },

    async appendSystemMessage(
      threadId: string,
      content: string,
    ): Promise<void> {
      const thread = createGoogleGenAIThreadManager({ redis, threadId });
      await thread.appendSystemMessage(content);
    },

    async appendToolResult(cfg: ToolResultConfig): Promise<void> {
      const { threadId, toolCallId, toolName, content } = cfg;
      const thread = createGoogleGenAIThreadManager({ redis, threadId });
      await thread.appendToolResult(toolCallId, toolName, content);
    },
  };

  const makeInvoker = (model: string): ModelInvoker<Content> =>
    createGoogleGenAIModelInvoker({ redis, client, model });

  const invoker: ModelInvoker<Content> = config.model
    ? makeInvoker(config.model)
    : ((() => {
        throw new Error(
          "No default model provided to createGoogleGenAIAdapter. " +
            "Either pass `model` in the config or use `createModelInvoker(model)` instead.",
        );
      }) as unknown as ModelInvoker<Content>);

  return {
    threadOps,
    invoker,
    createModelInvoker: makeInvoker,
  };
}
