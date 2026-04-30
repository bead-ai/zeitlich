import type { Sandbox } from "../sandbox/types";
import { SandboxNotFoundError } from "../sandbox/types";
import type { JsonValue } from "../state/types";
import type {
  ActivityToolHandler,
  RouterContext,
  ToolHandlerResponse,
} from "./types";

/**
 * Options for {@link withSandbox}.
 */
export interface WithSandboxOptions {
  /**
   * If `true`, a {@link SandboxNotFoundError} thrown by `manager.getSandbox`
   * is translated into a structured tool-handler response (instead of
   * propagating). This lets the agent return a graceful error to the model
   * rather than crashing the workflow when the backing sandbox has been
   * killed mid-run (e.g. because the E2B `timeoutMs` lifetime elapsed).
   *
   * Off by default to preserve the existing contract for callers that rely
   * on the error bubbling out. New callers should generally enable this in
   * combination with the E2B `keepAliveMs` provider option.
   *
   * @default false
   */
  translateSandboxNotFound?: boolean;
}

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
export function withSandbox<
  TArgs,
  TResult,
  TSandbox extends Sandbox = Sandbox,
  TToolResponse = JsonValue,
>(
  manager: { getSandbox(id: string): Promise<TSandbox> },
  handler: (
    args: TArgs,
    context: RouterContext & { sandbox: TSandbox; sandboxId: string }
  ) => Promise<ToolHandlerResponse<TResult, TToolResponse>>,
  options?: WithSandboxOptions
): ActivityToolHandler<
  TArgs,
  TResult | null,
  RouterContext,
  TToolResponse | string
> {
  const translateSandboxNotFound = options?.translateSandboxNotFound ?? false;
  return async (args, context) => {
    if (!context.sandboxId) {
      return {
        toolResponse: `Error: No sandbox configured for this agent. The ${context.toolName} tool requires a sandbox.`,
        data: null,
      };
    }
    let sandbox: TSandbox;
    try {
      sandbox = await manager.getSandbox(context.sandboxId);
    } catch (err) {
      if (translateSandboxNotFound && err instanceof SandboxNotFoundError) {
        return {
          toolResponse: `Error: the execution environment for the ${context.toolName} tool is no longer available, so this tool call could not be completed.`,
          data: null,
        };
      }
      throw err;
    }
    return handler(args, { ...context, sandbox, sandboxId: context.sandboxId });
  };
}
