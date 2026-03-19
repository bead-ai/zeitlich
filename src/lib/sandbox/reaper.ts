import {
  CancellationScope,
  condition,
  defineSignal,
  isCancellation,
  setHandler,
} from "@temporalio/workflow";

export type ParentCloseSandboxReaperWorkflow = (
  sandboxId: string
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
 * Creates a sandbox reaper workflow that waits for its parent workflow to
 * close, then destroys the paused sandbox unless it was explicitly dismissed.
 *
 * Call this at module level in your workflow file, passing
 * `sandboxOps.destroySandbox` from one of Zeitlich's sandbox workflow proxies.
 */
export function defineParentCloseSandboxReaper(
  destroySandbox: (sandboxId: string) => Promise<void>
): ParentCloseSandboxReaperWorkflow {
  const reaper: ParentCloseSandboxReaperWorkflow = async (
    sandboxId: string
  ) => {
    let dismissed = false;
    setHandler(dismissReaper, () => {
      dismissed = true;
    });

    try {
      await Promise.race([
        condition(() => dismissed),
        CancellationScope.current().cancelRequested,
      ]);
      if (dismissed) return;
    } catch (error) {
      if (!isCancellation(error)) {
        throw error;
      }
    }

    if (dismissed) return;

    await CancellationScope.nonCancellable(async () => {
      await destroySandbox(sandboxId);
    });
  };
  Object.defineProperty(reaper, "name", {
    value: "parentCloseSandboxReaper",
  });
  return reaper;
}
