import type Redis from "ioredis";
import type { ToolMessageContent } from "../types";
import type { ActivityToolHandler, RouterContext } from "./types";
import { createHash } from "node:crypto";

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days (matches thread TTL)

/**
 * Options for the {@link withCache} handler wrapper.
 */
export interface ToolCallCacheOptions {
  /** TTL for cached entries in seconds (default: 90 days) */
  ttl?: number;
}

function getCacheKey(
  threadId: string,
  toolName: string,
  args: unknown
): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(args))
    .digest("hex")
    .slice(0, 16);
  return `toolcache:${threadId}:${toolName}:${hash}`;
}

/**
 * Wraps a tool handler with an optional Redis-backed cache keyed by
 * workflow/thread ID, tool name, and input args.
 *
 * On a cache hit the handler is skipped entirely and the cached
 * `toolResponse` + `data` are returned. On a miss the handler runs
 * normally and its response is stored for future calls.
 *
 * Because the cache returns `resultAppended: false`, the router will
 * append the cached response to the thread as usual. Do **not** combine
 * with {@link withAutoAppend} — use one or the other.
 *
 * @param redis   - ioredis instance
 * @param handler - The original tool handler
 * @param options - Optional TTL override
 * @returns A wrapped handler with transparent caching
 *
 * @example
 * ```typescript
 * import Redis from 'ioredis';
 * import { withCache } from 'zeitlich';
 *
 * const redis = new Redis();
 * const handler = withCache(redis, async (args, ctx) => ({
 *   toolResponse: JSON.stringify(await fetchExpensiveData(args)),
 *   data: null,
 * }));
 * ```
 */
export function withCache<
  TArgs,
  TResult,
  TContext extends RouterContext = RouterContext,
>(
  redis: Redis,
  handler: ActivityToolHandler<TArgs, TResult, TContext>,
  options?: ToolCallCacheOptions,
): ActivityToolHandler<TArgs, TResult, TContext> {
  const ttl = options?.ttl ?? DEFAULT_TTL_SECONDS;

  return async (args: TArgs, context: TContext) => {
    const key = getCacheKey(context.threadId, context.toolName, args);

    const cached = await redis.get(key);
    if (cached !== null) {
      return JSON.parse(cached) as {
        toolResponse: ToolMessageContent;
        data: TResult;
      };
    }

    const response = await handler(args, context);

    await redis.set(
      key,
      JSON.stringify({ toolResponse: response.toolResponse, data: response.data }),
      "EX",
      ttl,
    );

    return response;
  };
}
