import { describe, expect, it } from "vitest";
import type { AgentStatus } from "./types";
import { isTerminalStatus } from "./types";

describe("isTerminalStatus", () => {
  it("returns true for COMPLETED", () => {
    expect(isTerminalStatus("COMPLETED")).toBe(true);
  });

  it("returns true for FAILED", () => {
    expect(isTerminalStatus("FAILED")).toBe(true);
  });

  it("returns true for CANCELLED", () => {
    expect(isTerminalStatus("CANCELLED")).toBe(true);
  });

  it("returns false for RUNNING", () => {
    expect(isTerminalStatus("RUNNING")).toBe(false);
  });

  it("returns false for WAITING_FOR_INPUT", () => {
    expect(isTerminalStatus("WAITING_FOR_INPUT")).toBe(false);
  });

  it("returns false for unknown status", () => {
    expect(isTerminalStatus("UNKNOWN" as AgentStatus)).toBe(false);
  });
});
