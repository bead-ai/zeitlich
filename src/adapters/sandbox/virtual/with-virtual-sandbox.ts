import type { WorkflowClient } from "@temporalio/client";
import { queryParentWorkflowState } from "../../../lib/activity";
import type { JsonValue } from "../../../lib/state/types";
import type { ActivityToolHandler, RouterContext } from "../../../lib/tool-router/types";
import type {
  FileEntryMetadata,
  TreeMutation,
  VirtualSandboxContext,
  VirtualSandboxState,
} from "./types";
import type { VirtualSandboxProvider } from "./provider";
import { createVirtualSandbox } from "./index";

/**
 * Wraps a tool handler that needs a virtual sandbox, automatically querying
 * the parent workflow for the current file tree and resolver context.
 *
 * On each invocation the wrapper:
 * 1. Queries the workflow's `AgentState` for `fileTree`, `resolverContext`, and `workspaceBase`
 * 2. Creates an ephemeral {@link VirtualSandbox} from tree + provider's resolver
 * 3. Runs the inner handler
 * 4. Returns the handler's result together with any {@link TreeMutation}s
 *
 * The consumer applies mutations back to workflow state via a post-tool hook.
 *
 * @param client    - Temporal `WorkflowClient` for querying the parent workflow
 * @param agentName - Agent name (used to derive the state query name)
 * @param provider  - {@link VirtualSandboxProvider} (wraps the resolver)
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
 * const provider = new VirtualSandboxProvider(resolver);
 * const handler = withVirtualSandbox(client, "myAgent", provider, readHandler);
 * ```
 */
export function withVirtualSandbox<
  TArgs,
  TResult,
  TCtx,
  TMeta = FileEntryMetadata,
  TToolResponse = JsonValue,
>(
  client: WorkflowClient,
  provider: VirtualSandboxProvider<TCtx, TMeta>,
  handler: ActivityToolHandler<
    TArgs,
    TResult,
    VirtualSandboxContext<TCtx, TMeta>,
    TToolResponse
  >
): ActivityToolHandler<
  TArgs,
  (TResult & { treeMutations: TreeMutation<TMeta>[] }) | null,
  RouterContext,
  TToolResponse | string
> {
  return async (args, context) => {
    const state =
      await queryParentWorkflowState<VirtualSandboxState<TCtx, TMeta>>(client);

    const { sandboxId, fileTree, resolverContext, workspaceBase } = state;
    if (!fileTree || !sandboxId) {
      return {
        toolResponse: `Error: No fileTree/sandboxId in agent state. The ${context.toolName} tool requires a virtual sandbox.`,
        data: null,
      };
    }

    const sandbox = createVirtualSandbox(
      sandboxId,
      fileTree,
      provider.resolver,
      resolverContext,
      workspaceBase ?? "/",
    );
    const response = await handler(args, { ...context, sandbox });
    const mutations = sandbox.fs.getMutations();

    return {
      toolResponse: response.toolResponse,
      data: {
        ...(response.data ?? {}),
        treeMutations: mutations,
      } as TResult & { treeMutations: TreeMutation<TMeta>[] },
    };
  };
}
