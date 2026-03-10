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
export function createRunAgentActivity<R>(
  client: WorkflowClient,
  handler: (config: RunAgentConfig & { state: BaseAgentState }) => Promise<R>,
): (config: RunAgentConfig) => Promise<R> {
  return async (config: RunAgentConfig) => {
    const state = await queryParentWorkflowState<BaseAgentState>(client);
    return handler({ ...config, state });
  };
}

/**
 * Context injected into tool handlers created via {@link withParentWorkflowState}.
 */
export interface AgentStateContext extends RouterContext {
  state: BaseAgentState;
}

/**
 * Wraps a tool handler into an `ActivityToolHandler` by auto-fetching the
 * parent workflow's agent state before each invocation.
 *
 * @example
 * ```typescript
 * import { withParentWorkflowState, type AgentStateContext } from 'zeitlich';
 *
 * const myHandler = withParentWorkflowState(client, async (args, ctx) => {
 *   console.log(ctx.state.systemPrompt);
 *   return { toolResponse: 'done', data: null };
 * });
 * ```
 */
export function withParentWorkflowState<TArgs, TResult>(
  client: WorkflowClient,
  handler: (
    args: TArgs,
    context: AgentStateContext,
  ) => Promise<ToolHandlerResponse<TResult>>,
): ActivityToolHandler<TArgs, TResult> {
  return async (args, context) => {
    const state = await queryParentWorkflowState<BaseAgentState>(client);
    return handler(args, { ...context, state });
  };
}
