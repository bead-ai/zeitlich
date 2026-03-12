import type { Sandbox } from "../sandbox/types";
import type {
  ActivityToolHandler,
  RouterContext,
  ToolHandlerResponse,
} from "./types";

/**
 * Extended router context with a resolved {@link Sandbox} instance.
 *
 * Handlers typed with this context are guaranteed to have a live sandbox
 * and a non-optional `sandboxId`. Use with {@link withSandbox} to
 * automatically resolve the sandbox from the manager.
 */
export interface SandboxContext extends RouterContext {
  sandbox: Sandbox;
  sandboxId: string;
}

/**
 * Wraps a tool handler that requires a {@link Sandbox}, automatically
 * resolving it from the manager via the `sandboxId` on the router context.
 *
 * If no `sandboxId` is present the wrapper short-circuits with an error
 * response and `data: null`, so the inner handler never runs without a
 * valid sandbox.
 *
 * The sandbox type parameter `TSandbox` is inferred from the manager's
 * `getSandbox` return type, allowing handlers to receive provider-specific
 * sandbox subtypes (e.g. `DaytonaSandbox`) without manual casting.
 *
 * @param manager - Any object with a `getSandbox` method (e.g. {@link SandboxManager})
 * @param handler - The inner handler that expects a sandbox context
 * @returns A standard `ActivityToolHandler` that can be registered on the router
 *
 * @example
 * ```typescript
 * import { withSandbox, type SandboxContext } from 'zeitlich';
 *
 * // Generic sandbox — works with any provider:
 * const bashHandler: ActivityToolHandler<BashArgs, ExecResult, SandboxContext> =
 *   async (args, { sandbox }) => {
 *     const result = await sandbox.exec(args.command);
 *     return { toolResponse: result.stdout, data: result };
 *   };
 * const handler = withSandbox(manager, bashHandler);
 *
 * // Provider-specific sandbox — use SandboxManager<DaytonaSandbox>:
 * const daytonaManager = new SandboxManager<DaytonaSandbox>(provider);
 * const handler2 = withSandbox(daytonaManager, async (args, { sandbox }) => {
 *   // sandbox is typed as DaytonaSandbox here
 *   await sandbox.fs.uploadFiles([...]);
 *   return { toolResponse: 'ok', data: null };
 * });
 * ```
 */
export function withSandbox<TArgs, TResult, TSandbox extends Sandbox = Sandbox>(
  manager: { getSandbox(id: string): Promise<TSandbox> },
  handler: (
    args: TArgs,
    context: RouterContext & { sandbox: TSandbox; sandboxId: string },
  ) => Promise<ToolHandlerResponse<TResult>>,
): ActivityToolHandler<TArgs, TResult | null> {
  return async (args, context) => {
    if (!context.sandboxId) {
      return {
        toolResponse: `Error: No sandbox configured for this agent. The ${context.toolName} tool requires a sandbox.`,
        data: null,
      };
    }
    const sandbox = await manager.getSandbox(context.sandboxId);
    return handler(args, { ...context, sandbox, sandboxId: context.sandboxId });
  };
}
