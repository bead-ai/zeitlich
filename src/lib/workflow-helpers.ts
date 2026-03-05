import { Context } from "@temporalio/activity";
import type { WorkflowClient } from "@temporalio/client";
import type { ModelInvoker } from "./model-invoker";
import type { AgentResponse, BaseAgentState, RunAgentConfig } from "./types";
import { agentQueryName } from "./types";

/**
 * Query the parent workflow's state from within an activity.
 * Resolves the workflow handle from the current activity context.
 */
export async function queryParentWorkflowState<T>(
  client: WorkflowClient,
  queryName: string
): Promise<T> {
  const { workflowExecution } = Context.current().info;
  const handle = client.getHandle(
    workflowExecution.workflowId,
    workflowExecution.runId
  );
  return handle.query<T>(queryName);
}

/**
 * Wraps a `ModelInvoker` into a `RunAgentActivity` by automatically
 * loading tool definitions from the parent workflow state via query.
 *
 * This is the generic bridge between any provider-specific model invoker
 * and the session's `runAgent` contract.
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
export function createRunAgentActivity<M>(
  client: WorkflowClient,
  invoker: ModelInvoker<M>
): (config: RunAgentConfig) => Promise<AgentResponse<M>> {
  return async (config: RunAgentConfig) => {
    const state = await queryParentWorkflowState<BaseAgentState>(
      client,
      agentQueryName(config.agentName)
    );
    return invoker({ ...config, state });
  };
}
