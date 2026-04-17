import { defineSignal } from "@temporalio/workflow";
import type { ChildSandboxReadySignalPayload } from "./types";

/** Sent by a child workflow as soon as its sandbox is created, before the agent loop starts. */
export const childSandboxReadySignal =
  defineSignal<[ChildSandboxReadySignalPayload]>("childSandboxReady");
