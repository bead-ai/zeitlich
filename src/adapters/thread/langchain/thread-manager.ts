import {
  type $InferMessageContent,
  AIMessage,
  HumanMessage,
  type MessageContent,
  type MessageStructure,
  type StoredMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type Redis from "ioredis";
import {
  type BaseThreadManager,
  createThreadManager,
  type ThreadManagerConfig,
} from "../../../lib/thread";

export type LangChainToolMessageContent = $InferMessageContent<
  MessageStructure,
  "tool"
>;

export interface LangChainThreadManagerConfig {
  redis: Redis;
  threadId: string;
  /** Thread key, defaults to 'messages' */
  key?: string;
}

/** Thread manager with LangChain StoredMessage convenience helpers */
export interface LangChainThreadManager
  extends BaseThreadManager<StoredMessage> {
  createHumanMessage(
    id: string,
    content: string | MessageContent,
  ): StoredMessage;
  createSystemMessage(id: string, content: string): StoredMessage;
  createAIMessage(
    id: string,
    content: string | MessageContent,
    kwargs?: { header?: string; options?: string[]; multiSelect?: boolean },
  ): StoredMessage;
  createToolMessage(
    id: string,
    content: LangChainToolMessageContent,
    toolCallId: string,
  ): StoredMessage;
  appendHumanMessage(
    id: string,
    content: string | MessageContent,
  ): Promise<void>;
  appendSystemMessage(id: string, content: string): Promise<void>;
  appendToolMessage(
    id: string,
    content: LangChainToolMessageContent,
    toolCallId: string,
  ): Promise<void>;
  appendAIMessage(id: string, content: string | MessageContent): Promise<void>;
}

function storedMessageId(msg: StoredMessage): string {
  if (msg.type === "tool" && msg.data.tool_call_id) {
    return msg.data.tool_call_id;
  }

  if (msg.data.id) {
    return msg.data.id;
  }

  throw new Error("No id found for message");
}

/**
 * Creates a LangChain-specific thread manager that stores StoredMessage
 * instances in Redis and provides convenience helpers for creating and
 * appending typed LangChain messages.
 */
export function createLangChainThreadManager(
  config: LangChainThreadManagerConfig,
): LangChainThreadManager {
  const baseConfig: ThreadManagerConfig<StoredMessage> = {
    redis: config.redis,
    threadId: config.threadId,
    key: config.key,
    idOf: storedMessageId,
  };

  const base = createThreadManager(baseConfig);

  const helpers = {
    createHumanMessage(
      id: string,
      content: string | MessageContent,
    ): StoredMessage {
      return new HumanMessage({
        id,
        content: content as string,
      }).toDict();
    },

    createSystemMessage(id: string, content: string): StoredMessage {
      return new SystemMessage({
        id,
        content: content as string,
      }).toDict();
    },

    createAIMessage(
      id: string,
      content: string,
      kwargs?: { header?: string; options?: string[]; multiSelect?: boolean },
    ): StoredMessage {
      return new AIMessage({
        id,
        content,
        additional_kwargs: kwargs
          ? {
              header: kwargs.header,
              options: kwargs.options,
              multiSelect: kwargs.multiSelect,
            }
          : undefined,
      }).toDict();
    },

    createToolMessage(
      id: string,
      content: LangChainToolMessageContent,
      toolCallId: string,
    ): StoredMessage {
      return new ToolMessage({
        id,
        content: content as MessageContent,
        tool_call_id: toolCallId,
      }).toDict();
    },

    async appendHumanMessage(
      id: string,
      content: string | MessageContent,
    ): Promise<void> {
      const message = helpers.createHumanMessage(id, content);
      await base.append([message]);
    },

    async appendToolMessage(
      id: string,
      content: LangChainToolMessageContent,
      toolCallId: string,
    ): Promise<void> {
      const message = helpers.createToolMessage(id, content, toolCallId);
      await base.append([message]);
    },

    async appendAIMessage(
      id: string,
      content: string | MessageContent,
    ): Promise<void> {
      const message = helpers.createAIMessage(id, content as string);
      await base.append([message]);
    },

    async appendSystemMessage(id: string, content: string): Promise<void> {
      const message = helpers.createSystemMessage(id, content);
      await base.initialize();
      await base.append([message]);
    },
  };

  return Object.assign(base, helpers);
}
