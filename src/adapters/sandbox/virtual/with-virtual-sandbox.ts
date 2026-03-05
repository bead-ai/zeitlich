import type { WorkflowClient } from "@temporalio/client";
import { queryParentWorkflowState } from "../../../lib/activity";
import { agentQueryName } from "../../../lib/types";
import type { ActivityToolHandler } from "../../../lib/tool-router/types";
import type {
  FileResolver,
  TreeMutation,
  VirtualSandboxContext,
  VirtualSandboxState,
} from "./types";
import { createVirtualSandbox } from "./index";

/**
 * Wraps a tool handler that needs a virtual sandbox, automatically querying
 * the parent workflow for the current file tree and resolver context.
 *
 * On each invocation the wrapper:
 * 1. Queries the workflow's `AgentState` for `fileTree` and `resolverContext`
 * 2. Creates an ephemeral {@link VirtualSandbox} from tree + resolver
 * 3. Runs the inner handler
 * 4. Returns the handler's result together with any {@link TreeMutation}s
 *
 * The consumer applies mutations back to workflow state via a post-tool hook.
 *
 * @param client    - Temporal `WorkflowClient` for querying the parent workflow
 * @param agentName - Agent name (used to derive the state query name)
 * @param resolver  - Consumer-provided {@link FileResolver}
 * @param handler   - Inner handler expecting a {@link VirtualSandboxContext}
 *
 * @example
 * ```typescript
 * import { withVirtualSandbox, type VirtualSandboxContext } from 'zeitlich';
 *
 * const readHandler: ActivityToolHandler<FileReadArgs, ReadResult, VirtualSandboxContext> =
 *   async (args, { sandbox }) => {
 *     const content = await sandbox.fs.readFile(args.path);
 *     return { toolResponse: content, data: { path: args.path, content } };
 *   };
 *
 * // At activity registration:
 * const handler = withVirtualSandbox(client, "myAgent", resolver, readHandler);
 * ```
 */
export function withVirtualSandbox<TArgs, TResult, TCtx>(
  client: WorkflowClient,
  agentName: string,
  resolver: FileResolver<TCtx>,
  handler: ActivityToolHandler<TArgs, TResult, VirtualSandboxContext>,
): ActivityToolHandler<
  TArgs,
  { result: TResult; treeMutations: TreeMutation[] } | null
> {
  return async (args, context) => {
    const state = await queryParentWorkflowState<VirtualSandboxState<TCtx>>(
      client,
      agentQueryName(agentName),
    );

    const { fileTree, resolverContext } = state;
    if (!fileTree) {
      return {
        toolResponse: `Error: No fileTree in agent state. The ${context.toolName} tool requires a virtual sandbox.`,
        data: null,
      };
    }

    const sandbox = createVirtualSandbox(fileTree, resolver, resolverContext);
    const response = await handler(args, { ...context, sandbox });
    const mutations = sandbox.fs.getMutations();

    return {
      toolResponse: response.toolResponse,
      data: { result: response.data, treeMutations: mutations },
    };
  };
}
