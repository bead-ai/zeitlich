import { defineSignal } from "@temporalio/workflow";
import type { ChildResultSignalPayload } from "./types";

export const childResultSignal =
  defineSignal<[ChildResultSignalPayload]>("childResult");
