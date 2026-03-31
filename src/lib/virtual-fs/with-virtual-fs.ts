import type { WorkflowClient } from "@temporalio/client";
import { queryParentWorkflowState } from "../activity";
import type { JsonValue } from "../state/types";
import type { ActivityToolHandler, RouterContext } from "../tool-router/types";
import type {
  FileEntryMetadata,
  FileResolver,
  TreeMutation,
  VirtualFsContext,
  VirtualFsState,
} from "./types";
import { VirtualFileSystem } from "./filesystem";

/**
 * Wraps a tool handler that needs a virtual filesystem, automatically querying
 * the parent workflow for the current file tree and resolver context.
 *
 * On each invocation the wrapper:
 * 1. Queries the workflow's `AgentState` for `fileTree`, `ctx`, and `workspaceBase`
 * 2. Creates an ephemeral {@link VirtualFileSystem} from tree + resolver
 * 3. Runs the inner handler
 * 4. Returns the handler's result together with any {@link TreeMutation}s
 *
 * The consumer applies mutations back to workflow state via a post-tool hook.
 *
 * @param client   - Temporal `WorkflowClient` for querying the parent workflow
 * @param resolver - {@link FileResolver} bridging to the consumer's data layer
 * @param handler  - Inner handler expecting a {@link VirtualFsContext}
 *
 * @example
 * ```typescript
 * import { withVirtualFs, type VirtualFsContext } from 'zeitlich';
 *
 * const readHandler: ActivityToolHandler<FileReadArgs, ReadResult, VirtualFsContext> =
 *   async (args, { virtualFs }) => {
 *     const content = await virtualFs.readFile(args.path);
 *     return { toolResponse: content, data: { path: args.path, content } };
 *   };
 *
 * // At activity registration:
 * const handler = withVirtualFs(client, resolver, readHandler);
 * ```
 */
export function withVirtualFs<
  TArgs,
  TResult,
  TCtx,
  TMeta = FileEntryMetadata,
  TToolResponse = JsonValue,
>(
  client: WorkflowClient,
  resolver: FileResolver<TCtx, TMeta>,
  handler: ActivityToolHandler<
    TArgs,
    TResult,
    VirtualFsContext<TCtx, TMeta>,
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
      await queryParentWorkflowState<VirtualFsState<TCtx, TMeta>>(client);

    const { fileTree, ctx, workspaceBase, inlineFiles } = state;
    if (!fileTree) {
      return {
        toolResponse: `Error: No fileTree in agent state. The ${context.toolName} tool requires a virtual filesystem.`,
        data: null,
      };
    }

    const virtualFs = new VirtualFileSystem(
      fileTree,
      resolver,
      ctx,
      workspaceBase ?? "/",
      inlineFiles,
    );
    const response = await handler(args, { ...context, virtualFs });
    const mutations = virtualFs.getMutations();

    return {
      toolResponse: response.toolResponse,
      data: {
        ...(response.data ?? {}),
        treeMutations: mutations,
      } as TResult & { treeMutations: TreeMutation<TMeta>[] },
    };
  };
}
