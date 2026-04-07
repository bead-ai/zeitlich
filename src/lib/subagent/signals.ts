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
