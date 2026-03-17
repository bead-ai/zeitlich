import {
  condition,
  defineSignal,
  setHandler,
} from "@temporalio/workflow";

export type SandboxReaperWorkflow = (
  sandboxId: string,
  ttlMs: number
) => Promise<void>;

export const dismissReaper = defineSignal("dismissSandboxReaper");

/**
 * Returns a deterministic workflow ID for the reaper of a given sandbox.
 * Used by both the session that starts the reaper and the session that
 * dismisses it on continuation.
 */
export function getReaperWorkflowId(sandboxId: string): string {
  return `sandbox-reaper-${sandboxId}`;
}

/**
 * Creates a sandbox reaper workflow that destroys a paused sandbox after a TTL.
 * If the reaper receives a {@link dismissReaper} signal before the TTL expires
 * (e.g. because the sandbox was forked for a continuation), it exits cleanly
 * without destroying anything — showing as "Completed" in Temporal's UI.
 *
 * Call this at module level in your workflow file, passing the activity stub
 * for your sandbox provider's destroy operation:
 *
 * @example
 * ```typescript
 * import { proxyActivities } from '@temporalio/workflow';
 * import { defineSandboxReaper } from 'zeitlich/workflow';
 *
 * const { e2bDestroySandbox } = proxyActivities<PrefixedSandboxOps<'e2b'>>({
 *   startToCloseTimeout: '30s',
 * });
 *
 * export const e2bSandboxReaper = defineSandboxReaper(e2bDestroySandbox);
 * ```
 */
export function defineSandboxReaper(
  destroySandbox: (sandboxId: string) => Promise<void>
): SandboxReaperWorkflow {
  const reaper: SandboxReaperWorkflow = async (
    sandboxId: string,
    ttlMs: number
  ) => {
    let dismissed = false;
    setHandler(dismissReaper, () => { dismissed = true; });

    const wasDismissed = await condition(() => dismissed, ttlMs);
    if (wasDismissed) return;

    await destroySandbox(sandboxId);
  };
  Object.defineProperty(reaper, "name", { value: "sandboxReaper" });
  return reaper;
}
