import type Redis from "ioredis";
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
import { v4 as uuidv4 } from "uuid";
import {
  createThreadManager,
  type BaseThreadManager,
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
export interface LangChainThreadManager extends BaseThreadManager<StoredMessage> {
  createHumanMessage(content: string | MessageContent): StoredMessage;
  createSystemMessage(content: string): StoredMessage;
  createAIMessage(
    content: string | MessageContent,
    kwargs?: { header?: string; options?: string[]; multiSelect?: boolean },
  ): StoredMessage;
  createToolMessage(
    content: LangChainToolMessageContent,
    toolCallId: string,
  ): StoredMessage;
  appendHumanMessage(content: string | MessageContent): Promise<void>;
  appendSystemMessage(content: string): Promise<void>;
  appendToolMessage(
    content: LangChainToolMessageContent,
    toolCallId: string,
  ): Promise<void>;
  appendAIMessage(content: string | MessageContent): Promise<void>;
}

function storedMessageId(msg: StoredMessage): string {
  return msg.data.id ?? "";
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
    createHumanMessage(content: string | MessageContent): StoredMessage {
      return new HumanMessage({
        id: uuidv4(),
        content: content as string,
      }).toDict();
    },

    createSystemMessage(content: string): StoredMessage {
      return new SystemMessage({
        id: uuidv4(),
        content: content as string,
      }).toDict();
    },

    createAIMessage(
      content: string,
      kwargs?: { header?: string; options?: string[]; multiSelect?: boolean },
    ): StoredMessage {
      return new AIMessage({
        id: uuidv4(),
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
      content: LangChainToolMessageContent,
      toolCallId: string,
    ): StoredMessage {
      return new ToolMessage({
        id: uuidv4(),
        content: content as MessageContent,
        tool_call_id: toolCallId,
      }).toDict();
    },

    async appendHumanMessage(content: string | MessageContent): Promise<void> {
      const message = helpers.createHumanMessage(content);
      await base.append([message]);
    },

    async appendToolMessage(
      content: LangChainToolMessageContent,
      toolCallId: string,
    ): Promise<void> {
      const message = helpers.createToolMessage(content, toolCallId);
      await base.append([message]);
    },

    async appendAIMessage(content: string | MessageContent): Promise<void> {
      const message = helpers.createAIMessage(content as string);
      await base.append([message]);
    },

    async appendSystemMessage(content: string): Promise<void> {
      const message = helpers.createSystemMessage(content);
      await base.initialize();
      await base.append([message]);
    },
  };

  return Object.assign(base, helpers);
}
