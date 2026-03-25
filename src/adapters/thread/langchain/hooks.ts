import type { BaseMessage, MessageContent } from "@langchain/core/messages";

type ContentBlock = MessageContent extends (infer U)[] | string ? U : never;

/**
 * Creates an `onPreparedMessage` hook that appends a cache-point content
 * block to the last message in the thread, and strips excess cache-point
 * blocks from earlier messages so the total never exceeds `maxBlocks`.
 *
 * Older cache-point blocks are removed first, keeping the most recent
 * `maxBlocks - 1` positions plus the last message's block.
 */
export function appendCachePoint(
  block: ContentBlock,
  { maxBlocks = 4 }: { maxBlocks?: number } = {},
): (message: BaseMessage, index: number, messages: readonly BaseMessage[]) => BaseMessage {
  return (message, index, messages) => {
    const isLast = index === messages.length - 1;

    if (isLast) {
      const { content } = message;
      if (Array.isArray(content)) {
        if (content.some((b) => b.type === block.type)) return message;
        message.content = [...content, block];
      } else if (typeof content === "string") {
        message.content = [{ type: "text", text: content }, block] satisfies MessageContent;
      }
      return message;
    }

    const { content } = message;
    if (!Array.isArray(content) || !content.some((b) => b.type === block.type)) {
      return message;
    }

    // Count cache blocks in messages after this one (excluding the last,
    // which always gets one) plus 1 for the last message itself.
    let cacheBlocksAfter = 1;
    for (let i = index + 1; i < messages.length - 1; i++) {
      const msg = messages[i];
      if (!msg) continue;
      const c = msg.content;
      if (Array.isArray(c) && c.some((b: ContentBlock) => b.type === block.type)) {
        cacheBlocksAfter++;
      }
    }

    if (cacheBlocksAfter >= maxBlocks) {
      message.content = content.filter((b) => b.type !== block.type);
    }

    return message;
  };
}
