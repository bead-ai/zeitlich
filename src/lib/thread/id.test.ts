import { describe, expect, it, vi, beforeEach } from "vitest";

let uuidCounter = 0;

vi.mock("@temporalio/workflow", () => ({
  uuid4: () => {
    uuidCounter++;
    const bytes = Array.from({ length: 16 }, (_, i) =>
      ((uuidCounter * 31 + i * 7 + uuidCounter * i) & 0xff)
        .toString(16)
        .padStart(2, "0"),
    ).join("");
    return `${bytes.slice(0, 8)}-${bytes.slice(8, 12)}-${bytes.slice(12, 16)}-${bytes.slice(16, 20)}-${bytes.slice(20, 32)}`;
  },
}));

import { getShortId } from "./id";

describe("getShortId", () => {
  beforeEach(() => {
    uuidCounter = 0;
  });

  it("returns a string of default length 12", () => {
    const id = getShortId();
    expect(id).toHaveLength(12);
  });

  it("returns a string of custom length", () => {
    const id = getShortId(6);
    expect(id).toHaveLength(6);
  });

  it("contains only base-62 characters", () => {
    const base62Regex = /^[A-Za-z0-9]+$/;
    for (let i = 0; i < 10; i++) {
      expect(getShortId()).toMatch(base62Regex);
    }
  });

  it("generates unique IDs on successive calls", () => {
    const ids = new Set(Array.from({ length: 20 }, () => getShortId()));
    expect(ids.size).toBe(20);
  });

  it("returns empty string for length 0", () => {
    const id = getShortId(0);
    expect(id).toBe("");
  });
});
