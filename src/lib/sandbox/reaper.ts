import { sleep } from "@temporalio/workflow";

export type SandboxReaperWorkflow = (
  sandboxId: string,
  ttlMs: number
) => Promise<void>;

/**
 * Returns a deterministic workflow ID for the reaper of a given sandbox.
 * Used by both the session that starts the reaper and the session that
 * cancels it on continuation.
 */
export function getReaperWorkflowId(sandboxId: string): string {
  return `sandbox-reaper-${sandboxId}`;
}

/**
 * Creates a sandbox reaper workflow that destroys a paused sandbox after a TTL.
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
    await sleep(ttlMs);
    await destroySandbox(sandboxId);
  };
  Object.defineProperty(reaper, "name", { value: "sandboxReaper" });
  return reaper;
}
