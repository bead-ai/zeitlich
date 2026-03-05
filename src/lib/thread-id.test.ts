import { describe, expect, it, vi } from "vitest";

vi.mock("@temporalio/workflow", () => ({
  uuid4: () => "550e8400-e29b-41d4-a716-446655440000",
}));

import { getShortId } from "./thread-id";

describe("getShortId", () => {
  it("returns a string of default length 12", () => {
    const id = getShortId();
    expect(id).toHaveLength(12);
  });

  it("returns a string of custom length", () => {
    const id = getShortId(8);
    expect(id).toHaveLength(8);
  });

  it("contains only base-62 characters", () => {
    const id = getShortId(16);
    expect(id).toMatch(
      /^[ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789]+$/
    );
  });

  it("produces deterministic output for same uuid", () => {
    const a = getShortId();
    const b = getShortId();
    expect(a).toBe(b);
  });

  it("returns empty string for length 0", () => {
    expect(getShortId(0)).toBe("");
  });
});
