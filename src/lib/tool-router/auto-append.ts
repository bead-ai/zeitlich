import type { ToolResultConfig } from "../types";
import type { ActivityToolHandler, RouterContext } from "./types";

/**
 * Wraps a tool handler to automatically append its result directly to the
 * thread and sets `resultAppended: true` on the response.
 *
 * Use this for tools whose responses may exceed Temporal's activity payload
 * limit. The wrapper appends to the thread inside the activity (where Redis
 * is available), then replaces `toolResponse` with an empty string so the
 * large payload never travels through the Temporal workflow boundary.
 *
 * @param getThread - Factory that returns a thread manager for the given threadId
 * @param handler   - The original tool handler
 * @returns A wrapped handler that auto-appends and flags the response
 *
 * @example
 * ```typescript
 * import { withAutoAppend } from '@bead-ai/zeitlich/workflow';
 * import { createThreadManager } from '@bead-ai/zeitlich';
 *
 * const handler = withAutoAppend(
 *   (threadId) => createThreadManager({ redis, threadId }),
 *   async (args, ctx) => ({
 *     toolResponse: JSON.stringify(largeResult), // appended directly to Redis
 *     data: { summary: "..." },                  // small data for workflow
 *   }),
 * );
 * ```
 */
export function withAutoAppend<
  TArgs,
  TResult,
  TContext extends RouterContext = RouterContext,
>(
  threadHandler: (config: ToolResultConfig) => Promise<void>,
  handler: ActivityToolHandler<TArgs, TResult, TContext>
): ActivityToolHandler<TArgs, TResult, TContext> {
  return async (args: TArgs, context: TContext) => {
    const response = await handler(args, context);

    await threadHandler({
      threadId: context.threadId,
      toolCallId: context.toolCallId,
      toolName: context.toolName,
      content: response.toolResponse,
    });

    return {
      toolResponse: "Response appended via withAutoAppend",
      data: response.data,
      resultAppended: true,
    };
  };
}
