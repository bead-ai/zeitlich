import { defineSignal } from "@temporalio/workflow";
import type {
  ChildResultSignalPayload,
  ChildSandboxReadySignalPayload,
} from "./types";

export const childResultSignal =
  defineSignal<[ChildResultSignalPayload]>("childResult");

/** Sent by a child workflow as soon as its sandbox is created, before the agent loop starts. */
export const childSandboxReadySignal =
  defineSignal<[ChildSandboxReadySignalPayload]>("childSandboxReady");

/** Sent by the parent to tell a subagent it may destroy its sandbox. */
export const destroySandboxSignal = defineSignal("destroySandbox");

/**
 * Sent by the parent to tell a subagent it may delete any snapshots it is
 * holding on to. Used by `sandboxShutdown: "snapshot"` children that stay
 * alive after returning their result so the parent can reuse their
 * snapshots across subsequent calls.
 */
export const cleanupSnapshotsSignal = defineSignal("cleanupSnapshots");
