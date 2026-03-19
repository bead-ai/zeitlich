import { defineSignal } from "@temporalio/workflow";
import type { ChildResultSignalPayload } from "./types";

export const childResultSignal =
  defineSignal<[ChildResultSignalPayload]>("childResult");

/** Sent by the parent to tell a subagent it may destroy its sandbox. */
export const destroySandboxSignal = defineSignal("destroySandbox");
