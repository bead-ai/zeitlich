import type Redis from "ioredis";
import type {
  GoogleGenAI,
  Content,
  FunctionDeclaration,
} from "@google/genai";
import type { AgentResponse, SerializableToolDefinition } from "../../../lib/types";
import type { ModelInvokerConfig } from "../../../lib/model-invoker";
import { createGoogleGenAIThreadManager } from "./thread-manager";

export interface GoogleGenAIModelInvokerConfig {
  redis: Redis;
  client: GoogleGenAI;
  model: string;
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
 * Merge consecutive Content objects sharing the same role.
 * The Gemini API requires alternating user/model turns; without
 * merging, multiple sequential tool-result messages would violate this.
 */
function mergeConsecutiveContents(contents: Content[]): Content[] {
  const merged: Content[] = [];
  for (const content of contents) {
    const last = merged[merged.length - 1];
    if (last && last.role === content.role) {
      last.parts = [...(last.parts ?? []), ...(content.parts ?? [])];
    } else {
      merged.push({ ...content, parts: [...(content.parts ?? [])] });
    }
  }
  return merged;
}

/**
 * Creates a Google GenAI model invoker that satisfies the generic
 * `ModelInvoker<Content>` contract.
 *
 * Loads the conversation thread from Redis, invokes the Gemini model via
 * `client.models.generateContent`, appends the AI response, and returns
 * a normalised AgentResponse.
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
}: GoogleGenAIModelInvokerConfig) {
  return async function invokeGoogleGenAIModel(
    config: ModelInvokerConfig,
  ): Promise<AgentResponse<Content>> {
    const { threadId, state } = config;

    const thread = createGoogleGenAIThreadManager({ redis, threadId });
    const stored = await thread.load();

    // Separate system instructions from conversation content.
    // Google GenAI takes system instructions via config, not in the contents array.
    let systemInstruction: string | undefined;
    const conversationContents: Content[] = [];

    for (const item of stored) {
      if (item.content.role === "system") {
        systemInstruction = item.content.parts?.[0]?.text;
      } else {
        conversationContents.push(item.content);
      }
    }

    const contents = mergeConsecutiveContents(conversationContents);

    const functionDeclarations = toFunctionDeclarations(state.tools);
    const tools =
      functionDeclarations.length > 0
        ? [{ functionDeclarations }]
        : undefined;

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

    await thread.appendModelContent(responseParts);

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
  config,
}: {
  redis: Redis;
  client: GoogleGenAI;
  model: string;
  config: ModelInvokerConfig;
}): Promise<AgentResponse<Content>> {
  const invoker = createGoogleGenAIModelInvoker({ redis, client, model });
  return invoker(config);
}
