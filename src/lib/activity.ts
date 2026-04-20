import { Context } from "@temporalio/activity";
import type { WorkflowClient } from "@temporalio/client";
import type { BaseAgentState, RunAgentConfig } from "./types";
import type { JsonValue } from "./state/types";
import type {
  ActivityToolHandler,
  RouterContext,
  ToolHandlerResponse,
} from "./tool-router/types";

/**
 * Safely retrieve Temporal activity heartbeat and cancellation signal.
 * Returns empty object when called outside a Temporal activity (e.g. tests).
 */
export function getActivityContext(): {
  heartbeat?: () => void;
  signal?: AbortSignal;
} {
  try {
    const ctx = Context.current();
    return { heartbeat: () => ctx.heartbeat(), signal: ctx.cancellationSignal };
  } catch {
    return {};
  }
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
 * Wraps a handler into a scope-prefixed `RunAgentActivity` by auto-fetching
 * the parent workflow's agent state before each invocation.
 *
 * Returns a `Record` with a single key `run<Scope>` so it can be spread
 * into the activities object alongside adapter activities.
 *
 * @param scope - Workflow scope used to derive the activity name.
 *   `"myAgentWorkflow"` produces `{ runMyAgentWorkflow: fn }`.
 *
 * @example
 * ```typescript
 * import { createRunAgentActivity } from 'zeitlich';
 *
 * return {
 *   ...adapter.createActivities("myAgentWorkflow"),
 *   ...createRunAgentActivity(client, adapter.invoker, "myAgentWorkflow"),
 * };
 * ```
 */
export function createRunAgentActivity<
  R,
  S extends BaseAgentState = BaseAgentState,
>(
  client: WorkflowClient,
  handler: (config: RunAgentConfig & { state: S }) => Promise<R>,
  scope: string
): Record<string, (config: RunAgentConfig) => Promise<R>> {
  const name = `run${scope.charAt(0).toUpperCase()}${scope.slice(1)}`;
  return {
    [name]: async (config: RunAgentConfig) => {
      const state = await queryParentWorkflowState<S>(client);
      return handler({ ...config, state });
    },
  };
}

/**
 * Context injected into tool handlers created via {@link withParentWorkflowState}.
 */
export interface AgentStateContext<
  S extends BaseAgentState = BaseAgentState,
> extends RouterContext {
  state: S;
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
export function withParentWorkflowState<
  TArgs,
  TResult,
  S extends BaseAgentState = BaseAgentState,
  TToolResponse = JsonValue,
>(
  client: WorkflowClient,
  handler: (
    args: TArgs,
    context: AgentStateContext<S>
  ) => Promise<ToolHandlerResponse<TResult, TToolResponse>>
): ActivityToolHandler<TArgs, TResult, RouterContext, TToolResponse> {
  return async (args, context) => {
    const state = await queryParentWorkflowState<S>(client);
    return handler(args, { ...context, state });
  };
}
