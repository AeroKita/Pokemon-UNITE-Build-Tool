import { describe, expect, it } from "vitest";
import { activeTierIndex } from "../heldItemDetail";

describe("heldItemDetail", () => {
  it("maps grade ranges to the active tier index (1-9 / 10-19 / 20-40)", () => {
    expect(activeTierIndex(1)).toBe(0);
    expect(activeTierIndex(9)).toBe(0);
    expect(activeTierIndex(10)).toBe(1);
    expect(activeTierIndex(19)).toBe(1);
    expect(activeTierIndex(20)).toBe(2);
    expect(activeTierIndex(40)).toBe(2);
  });
});
