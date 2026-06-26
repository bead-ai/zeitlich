import type { ThreadInit, SandboxInit, SandboxShutdown } from "./lifecycle";
import type { SandboxSnapshot } from "./sandbox/types";
import type { AgentStatus, TokenUsage } from "./types";

/**
 * Session config fields derived from a main workflow input, ready to spread
 * into `createSession`.
 */
export interface WorkflowSessionInput {
  /** Agent name — spread directly into `createSession` */
  agentName: string;
  /** Thread initialization strategy */
  thread?: ThreadInit;
  /** Sandbox initialization strategy */
  sandbox?: SandboxInit;
  /** Sandbox shutdown policy (default: "destroy") */
  sandboxShutdown?: SandboxShutdown;
  /**
   * Called by the session right before `runSession` returns. Installed by
   * `defineWorkflow` to capture sandbox / thread / usage outputs and forward
   * them to the workflow's `onSessionExit` config hook. Spread into
   * `createSession` via `...sessionInput`.
   */
  onSessionExit?: (result: {
    sandboxId?: string;
    snapshot?: SandboxSnapshot;
    threadId: string;
    /** Final agent status from the state manager. */
    status: AgentStatus;
    /** Thread adapter id reported by `loadThreadState`. */
    threadAdapter?: string;
    usage: {
      totalInputTokens: number;
      totalOutputTokens: number;
      totalCachedWriteTokens: number;
      totalCachedReadTokens: number;
      totalReasonTokens: number;
      turns: number;
    };
  }) => void;
}

/** Raw workflow input fields that map into `WorkflowSessionInput`. */
export interface WorkflowInput {
  /** Thread initialization strategy (default: `{ mode: "new" }`) */
  thread?: ThreadInit;
  /** Sandbox initialization strategy */
  sandbox?: SandboxInit;
}

export interface WorkflowConfig {
  /** Workflow name — used as the Temporal workflow function name */
  name: string;
  /**
   * Sandbox shutdown policy applied when the main agent session exits.
   *
   * - `"destroy"` (default) — destroy the sandbox on exit.
   * - `"pause"` — pause the sandbox so it can be resumed later.
   * - `"keep"` — leave the sandbox running (no-op on exit).
   */
  sandboxShutdown?: SandboxShutdown;
  /**
   * Called right before the underlying session exits, with the sandbox /
   * thread outputs and normalized token usage. Mirrors the capture logic in
   * `defineSubagentWorkflow`; useful for emitting metrics or persisting
   * sandbox / thread ids without threading them through the handler result.
   */
  onSessionExit?: (result: {
    sandboxId?: string;
    snapshot?: SandboxSnapshot;
    threadId: string;
    /** Final agent status from the state manager. */
    status: AgentStatus;
    /** Thread adapter id reported by `loadThreadState`. */
    threadAdapter?: string;
    usage: TokenUsage;
  }) => void;
}

/**
 * Wraps a main workflow function, translating workflow input fields into
 * session-compatible fields that can be spread directly into `createSession`.
 *
 * The wrapper:
 * - Accepts a `config` with at least a `name` (used for Temporal workflow naming)
 * - Accepts a handler `fn` receiving `(input, sessionInput)`
 * - Derives thread / sandbox init from `workflowInput`
 * - Applies the configured `sandboxShutdown` policy
 */
export function defineWorkflow<TInput, TResult>(
  config: WorkflowConfig,
  fn: (input: TInput, sessionInput: WorkflowSessionInput) => Promise<TResult>
): (input: TInput, workflowInput?: WorkflowInput) => Promise<TResult> {
  const workflow = async (
    input: TInput,
    workflowInput: WorkflowInput = {}
  ): Promise<TResult> => {
    const sessionInput: WorkflowSessionInput = {
      agentName: config.name,
      sandboxShutdown: config.sandboxShutdown ?? "destroy",
      ...(workflowInput.thread && { thread: workflowInput.thread }),
      ...(workflowInput.sandbox && { sandbox: workflowInput.sandbox }),
      ...(config.onSessionExit && {
        onSessionExit: ({
          sandboxId,
          snapshot,
          threadId,
          status,
          threadAdapter,
          usage,
        }): void => {
          config.onSessionExit?.({
            ...(sandboxId !== undefined && { sandboxId }),
            ...(snapshot !== undefined && { snapshot }),
            threadId,
            status,
            ...(threadAdapter !== undefined && { threadAdapter }),
            usage: {
              inputTokens: usage.totalInputTokens,
              outputTokens: usage.totalOutputTokens,
              cachedWriteTokens: usage.totalCachedWriteTokens,
              cachedReadTokens: usage.totalCachedReadTokens,
              reasonTokens: usage.totalReasonTokens,
            },
          });
        },
      }),
    };
    return fn(input, sessionInput);
  };

  Object.defineProperty(workflow, "name", { value: config.name });

  return workflow;
}
