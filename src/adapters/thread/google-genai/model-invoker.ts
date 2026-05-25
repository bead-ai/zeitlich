import { randomBytes } from "node:crypto";
import type Redis from "ioredis";
import type {
  GoogleGenAI,
  Content,
  FunctionDeclaration,
  GenerateContentConfig,
  Part,
  GenerateContentResponse,
} from "@google/genai";
import type { SerializableToolDefinition } from "../../../lib/types";
import type { AgentResponse, ModelInvokerConfig } from "../../../lib/model";
import {
  createGoogleGenAIThreadManager,
  type GoogleGenAIThreadManagerHooks,
} from "./thread-manager";
import { getActivityContext } from "../../../lib/activity";

export interface GoogleGenAIModelInvokerConfig {
  redis: Redis;
  client: GoogleGenAI;
  model: string;
  hooks?: GoogleGenAIThreadManagerHooks;
  /** Passed through to `generateContentStream().config`.
   *  `systemInstruction`, `tools`, and `abortSignal` are managed by the
   *  invoker and will override any values set here. */
  config?: GenerateContentConfig;
}

function toFunctionDeclarations(
  tools: SerializableToolDefinition[]
): FunctionDeclaration[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: t.schema,
  }));
}

/**
 * The caller is responsible for appending the returned response to the thread.
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
  config: generationConfig,
}: GoogleGenAIModelInvokerConfig) {
  return async function invokeGoogleGenAIModel(
    config: ModelInvokerConfig
  ): Promise<AgentResponse<Content>> {
    const { threadId, threadKey, state, assistantMessageId } = config;
    const { heartbeat, signal } = getActivityContext();

    const thread = createGoogleGenAIThreadManager({
      redis,
      threadId,
      key: threadKey,
      hooks,
    });
    // Truncate the thread starting at the id the assistant message
    // will be stored under. No-op on the first attempt; on rewind
    // retry / Temporal reset it wipes the prior attempt's assistant
    // + tool results so the LLM sees the original pre-call state.
    await thread.truncateFromId(assistantMessageId);
    const { contents, systemInstruction } = await thread.prepareForInvocation();

    const functionDeclarations = toFunctionDeclarations(state.tools);
    const tools =
      functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined;

    const {
      systemInstruction: _si,
      tools: _t,
      abortSignal: _as,
      ...callerConfig
    } = generationConfig ?? {};

    const stream = await client.models.generateContentStream({
      model,
      contents,
      config: {
        ...callerConfig,
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

    for (const part of allParts) {
      if (part.functionCall && !part.functionCall.id) {
        part.functionCall.id = randomBytes(8).toString("hex");
      }
    }

    const modelContent: Content = { role: "model", parts: allParts };

    return {
      message: modelContent,
      rawToolCalls: allParts
        .filter(
          (
            p
          ): p is Part & { functionCall: NonNullable<Part["functionCall"]> } =>
            !!p.functionCall
        )
        .map((p) => ({
          id: p.functionCall.id,
          name: p.functionCall.name ?? "",
          args: p.functionCall.args ?? {},
        })),
      usage: {
        inputTokens: lastChunk.usageMetadata?.promptTokenCount,
        outputTokens: lastChunk.usageMetadata?.candidatesTokenCount,
        cachedReadTokens: lastChunk.usageMetadata?.cachedContentTokenCount,
        reasonTokens: lastChunk.usageMetadata?.thoughtsTokenCount,
      },
    };
  };
}

export async function invokeGoogleGenAIModel({
  redis,
  client,
  model,
  hooks,
  config,
  generationConfig,
}: {
  redis: Redis;
  client: GoogleGenAI;
  model: string;
  hooks?: GoogleGenAIThreadManagerHooks;
  config: ModelInvokerConfig;
  generationConfig?: GenerateContentConfig;
}): Promise<AgentResponse<Content>> {
  const invoker = createGoogleGenAIModelInvoker({
    redis,
    client,
    model,
    hooks,
    config: generationConfig,
  });
  return invoker(config);
}
