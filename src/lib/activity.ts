import { createHash } from "node:crypto";
import { Context } from "@temporalio/activity";
import type { WorkflowClient } from "@temporalio/client";
import type Redis from "ioredis";
import type { BaseAgentState, RunAgentConfig } from "./types";
import type {
  ActivityToolHandler,
  RouterContext,
  ToolHandlerResponse,
} from "./tool-router/types";

const TOOL_CALL_CACHE_KEY_PREFIX = "tool-call-cache";
const TOOL_CALL_CACHE_TTL_SECONDS = 60 * 60 * 24; // 24 hours

function normalizeForStableSerialization(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeForStableSerialization);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [
          key,
          normalizeForStableSerialization(nestedValue),
        ])
    );
  }

  return value;
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(normalizeForStableSerialization(value)) ?? "undefined";
}

function createToolCallCacheKey(
  workflowId: string,
  toolName: string,
  args: unknown,
  keyPrefix: string
): string {
  const inputHash = createHash("sha256")
    .update(stableSerialize(args))
    .digest("hex");
  return `${keyPrefix}:${workflowId}:${toolName}:${inputHash}`;
}

/**
 * Query the parent workflow's state from within an activity.
 * Resolves the workflow handle from the current activity context.
 */
export async function queryParentWorkflowState<T>(
  client: WorkflowClient
): Promise<T> {
  const { workflowExecution } = Context.current().info;
  const handle = client.getHandle(
    workflowExecution.workflowId,
    workflowExecution.runId
  );
  return handle.query<T>("getAgentState");
}

/**
 * Wraps a handler into a `RunAgentActivity` by auto-fetching the parent
 * workflow's agent state before each invocation.
 *
 * @example
 * ```typescript
 * import { createRunAgentActivity } from 'zeitlich';
 * import { createLangChainModelInvoker } from 'zeitlich/adapters/thread/langchain';
 *
 * const invoker = createLangChainModelInvoker({ redis, model });
 * return { runAgent: createRunAgentActivity(client, invoker) };
 * ```
 */
export function createRunAgentActivity<R, S extends BaseAgentState = BaseAgentState>(
  client: WorkflowClient,
  handler: (config: RunAgentConfig & { state: S }) => Promise<R>,
): (config: RunAgentConfig) => Promise<R> {
  return async (config: RunAgentConfig) => {
    const state = await queryParentWorkflowState<S>(client);
    return handler({ ...config, state });
  };
}

/**
 * Context injected into tool handlers created via {@link withParentWorkflowState}.
 */
export interface AgentStateContext<S extends BaseAgentState = BaseAgentState> extends RouterContext {
  state: S;
}

/**
 * Configuration for {@link withToolCallCache}.
 */
export interface ToolCallCacheOptions<TResult = unknown> {
  /** Redis key prefix, defaults to `tool-call-cache`. */
  keyPrefix?: string;
  /** TTL in seconds for cached entries, defaults to 24 hours. */
  ttlSeconds?: number;
  /** Override how tool responses are serialized before being cached. */
  serialize?: (response: ToolHandlerResponse<TResult>) => string;
  /** Override how cached tool responses are restored. */
  deserialize?: (raw: string) => ToolHandlerResponse<TResult>;
}

/**
 * Wraps a tool handler into an `ActivityToolHandler` by auto-fetching the
 * parent workflow's agent state before each invocation.
 *
 * @typeParam S - Custom agent state type (defaults to `BaseAgentState`)
 *
 * @example
 * ```typescript
 * import { withParentWorkflowState, type AgentStateContext } from 'zeitlich';
 *
 * // With custom state:
 * interface MyState extends BaseAgentState { customField: string }
 * const myHandler = withParentWorkflowState<MyArgs, MyResult, MyState>(
 *   client,
 *   async (args, ctx) => {
 *     console.log(ctx.state.customField);
 *     return { toolResponse: 'done', data: null };
 *   },
 * );
 * ```
 */
export function withParentWorkflowState<TArgs, TResult, S extends BaseAgentState = BaseAgentState>(
  client: WorkflowClient,
  handler: (
    args: TArgs,
    context: AgentStateContext<S>,
  ) => Promise<ToolHandlerResponse<TResult>>,
): ActivityToolHandler<TArgs, TResult> {
  return async (args, context) => {
    const state = await queryParentWorkflowState<S>(client);
    return handler(args, { ...context, state });
  };
}

/**
 * Wraps an activity-side tool handler with a Redis-backed cache scoped to the
 * current Temporal workflow and tool input.
 *
 * Cache failures are treated as a best-effort optimization: Redis read/write
 * errors fall through to the underlying handler without affecting tool execution.
 * Responses that already append their own result (`resultAppended`) are not
 * cached because replaying them would skip the append for future tool calls.
 */
export function withToolCallCache<
  TArgs,
  TResult,
  TContext extends RouterContext = RouterContext,
>(
  redis: Pick<Redis, "get" | "set">,
  handler: ActivityToolHandler<TArgs, TResult, TContext>,
  options: ToolCallCacheOptions<TResult> = {}
): ActivityToolHandler<TArgs, TResult, TContext> {
  const {
    keyPrefix = TOOL_CALL_CACHE_KEY_PREFIX,
    ttlSeconds = TOOL_CALL_CACHE_TTL_SECONDS,
    serialize = (response: ToolHandlerResponse<TResult>): string =>
      JSON.stringify(response),
    deserialize = (raw: string): ToolHandlerResponse<TResult> =>
      JSON.parse(raw) as ToolHandlerResponse<TResult>,
  } = options;

  return async (args, context) => {
    if (ttlSeconds > 0) {
      const workflowId = Context.current().info.workflowExecution.workflowId;
      const cacheKey = createToolCallCacheKey(
        workflowId,
        context.toolName,
        args,
        keyPrefix
      );

      try {
        const cachedResponse = await redis.get(cacheKey);
        if (cachedResponse !== null) {
          return deserialize(cachedResponse);
        }
      } catch {
        // Cache misses and cache transport issues should not block tool execution.
      }

      const response = await handler(args, context);
      if (response.resultAppended) {
        return response;
      }

      try {
        await redis.set(cacheKey, serialize(response), "EX", ttlSeconds);
      } catch {
        // Cache writes are opportunistic; return the live response either way.
      }

      return response;
    }

    return handler(args, context);
  };
}
