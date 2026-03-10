import { Context } from "@temporalio/activity";
import type { WorkflowClient } from "@temporalio/client";
import type { ModelInvoker, AgentResponse } from "./model/types";
import type { BaseAgentState, RunAgentConfig } from "./types";

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
 * Wraps a {@link ModelInvoker} so that the parent workflow's agent state is
 * automatically fetched and injected before each invocation.
 *
 * @param client  - Temporal `WorkflowClient` used to query the parent workflow
 * @param invoker - The inner model invoker that expects state in its config
 * @returns A `RunAgentActivity` that can be registered directly on the worker
 *
 * @example
 * ```typescript
 * import { withParentWorkflowState } from 'zeitlich';
 * import { createLangChainModelInvoker } from 'zeitlich/adapters/thread/langchain';
 *
 * const invoker = createLangChainModelInvoker({ redis, model });
 * return { runAgent: withParentWorkflowState(client, invoker) };
 * ```
 */
export function withParentWorkflowState<M>(
  client: WorkflowClient,
  invoker: ModelInvoker<M>
): (config: RunAgentConfig) => Promise<AgentResponse<M>> {
  return async (config: RunAgentConfig) => {
    const state = await queryParentWorkflowState<BaseAgentState>(client);
    return invoker({ ...config, state });
  };
}
