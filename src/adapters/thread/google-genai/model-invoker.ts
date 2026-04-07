import type Redis from "ioredis";
import type { GoogleGenAI, Content, FunctionDeclaration, Part, GenerateContentResponse } from "@google/genai";
import type { SerializableToolDefinition } from "../../../lib/types";
import type { AgentResponse, ModelInvokerConfig } from "../../../lib/model";
import { createGoogleGenAIThreadManager, type GoogleGenAIThreadManagerHooks } from "./thread-manager";
import { getActivityContext } from "../../../lib/activity";

export interface GoogleGenAIModelInvokerConfig {
  redis: Redis;
  client: GoogleGenAI;
  model: string;
  hooks?: GoogleGenAIThreadManagerHooks;
}

function toFunctionDeclarations(
  tools: SerializableToolDefinition[],
): FunctionDeclaration[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: t.schema,
  }));
}

/**
 * Creates a Google GenAI model invoker that satisfies the generic
 * `ModelInvoker<Content>` contract.
 *
 * Internally streams the response and emits Temporal heartbeats on each
 * chunk so that long-running LLM calls remain visible to the scheduler.
 * The caller is responsible for appending the response to the thread.
 *
 * @example
 * ```typescript
 * import { createGoogleGenAIModelInvoker } from 'zeitlich/adapters/thread/google-genai';
 * import { createRunAgentActivity } from 'zeitlich';
 * import { GoogleGenAI } from '@google/genai';
 *
 * const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
 * const invoker = createGoogleGenAIModelInvoker({
 *   redis,
 *   client,
 *   model: 'gemini-2.5-flash',
 * });
 *
 * return { ...createRunAgentActivity(client, invoker, "myAgent") };
 * ```
 */
export function createGoogleGenAIModelInvoker({
  redis,
  client,
  model,
  hooks,
}: GoogleGenAIModelInvokerConfig) {
  return async function invokeGoogleGenAIModel(
    config: ModelInvokerConfig,
  ): Promise<AgentResponse<Content>> {
    const { threadId, threadKey, state } = config;
    const { heartbeat, signal } = getActivityContext();

    const thread = createGoogleGenAIThreadManager({ redis, threadId, key: threadKey, hooks });
    const { contents, systemInstruction } =
      await thread.prepareForInvocation();

    const functionDeclarations = toFunctionDeclarations(state.tools);
    const tools =
      functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined;

    const stream = await client.models.generateContentStream({
      model,
      contents,
      config: {
        ...(systemInstruction ? { systemInstruction } : {}),
        ...(tools ? { tools } : {}),
        abortSignal: signal,
      },
    });

    const allParts: Part[] = [];
    let lastChunk: GenerateContentResponse | undefined;
    for await (const chunk of stream) {
      lastChunk = chunk;
      allParts.push(...(chunk.candidates?.[0]?.content?.parts ?? []));
      heartbeat?.();
    }

    if (!lastChunk) {
      throw new Error("Google GenAI stream ended without producing any chunks");
    }

    const modelContent: Content = { role: "model", parts: allParts };
    const functionCalls = lastChunk.functionCalls ?? [];

    return {
      message: modelContent,
      rawToolCalls: functionCalls.map((fc) => ({
        id: fc.id,
        name: fc.name ?? "",
        args: fc.args ?? {},
      })),
      usage: {
        inputTokens: lastChunk.usageMetadata?.promptTokenCount,
        outputTokens: lastChunk.usageMetadata?.candidatesTokenCount,
        cachedReadTokens: lastChunk.usageMetadata?.cachedContentTokenCount,
      },
    };
  };
}

/**
 * Standalone function for one-shot Google GenAI model invocation.
 * Convenience wrapper around createGoogleGenAIModelInvoker for cases
 * where you don't need to reuse the invoker.
 */
export async function invokeGoogleGenAIModel({
  redis,
  client,
  model,
  hooks,
  config,
}: {
  redis: Redis;
  client: GoogleGenAI;
  model: string;
  hooks?: GoogleGenAIThreadManagerHooks;
  config: ModelInvokerConfig;
}): Promise<AgentResponse<Content>> {
  const invoker = createGoogleGenAIModelInvoker({ redis, client, model, hooks });
  return invoker(config);
}
