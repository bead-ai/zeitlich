import { Context } from "@temporalio/activity";
import type { WorkflowClient } from "@temporalio/client";
import type { BaseAgentState, RunAgentConfig } from "./types";
import type {
  ActivityToolHandler,
  RouterContext,
  ToolHandlerResponse,
} from "./tool-router/types";

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
