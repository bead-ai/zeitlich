import type Redis from "ioredis";
import type { GoogleGenAI, Content, FunctionDeclaration } from "@google/genai";
import type { SerializableToolDefinition } from "../../../lib/types";
import type { AgentResponse, ModelInvokerConfig } from "../../../lib/model";
import { createGoogleGenAIThreadManager, type GoogleGenAIThreadManagerHooks } from "./thread-manager";

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
 * Loads the conversation thread from Redis, invokes the Gemini model via
 * `client.models.generateContent`, and returns a normalised AgentResponse.
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
 * return { runAgent: createRunAgentActivity(client, invoker) };
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

    const thread = createGoogleGenAIThreadManager({ redis, threadId, key: threadKey, hooks });
    const { contents, systemInstruction } =
      await thread.prepareForInvocation();

    const functionDeclarations = toFunctionDeclarations(state.tools);
    const tools =
      functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined;

    const response = await client.models.generateContent({
      model,
      contents,
      config: {
        ...(systemInstruction ? { systemInstruction } : {}),
        ...(tools ? { tools } : {}),
      },
    });

    const responseParts = response.candidates?.[0]?.content?.parts ?? [];
    const modelContent: Content = { role: "model", parts: responseParts };

    const functionCalls = response.functionCalls ?? [];

    return {
      message: modelContent,
      rawToolCalls: functionCalls.map((fc) => ({
        id: fc.id,
        name: fc.name ?? "",
        args: fc.args ?? {},
      })),
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
        cachedReadTokens: response.usageMetadata?.cachedContentTokenCount,
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
