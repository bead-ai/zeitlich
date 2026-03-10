import { describe, expect, it } from "vitest";
import { isTerminalStatus } from "./types";
import type { AgentStatus } from "./types";

describe("isTerminalStatus", () => {
  it.each<[AgentStatus, boolean]>([
    ["COMPLETED", true],
    ["FAILED", true],
    ["CANCELLED", true],
    ["RUNNING", false],
    ["WAITING_FOR_INPUT", false],
  ])("returns %s for status %s", (status, expected) => {
    expect(isTerminalStatus(status)).toBe(expected);
  });
});
