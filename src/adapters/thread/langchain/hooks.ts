import type { BaseMessage, MessageContent } from "@langchain/core/messages";

type ContentBlock = MessageContent extends (infer U)[] | string ? U : never;

/**
 * Creates an `onPreparedMessage` hook that appends a cache-point content
 * block to the last message in the thread.
 *
 * Skips appending if the last message already contains a block with the
 * same `type`.
 */
export function appendCachePoint(
  block: ContentBlock,
): (message: BaseMessage, index: number, messages: readonly BaseMessage[]) => BaseMessage {
  return (message, index, messages) => {
    if (index !== messages.length - 1) {
      return message;
    }

    const { content } = message;

    if (Array.isArray(content)) {
      if (content.some((b) => b.type === block.type)) {
        return message;
      }
      message.content = [...content, block];
      return message;
    }

    if (typeof content === "string") {
      message.content = [{ type: "text", text: content }, block] satisfies MessageContent;
      return message;
    }

    return message;
  };
}
