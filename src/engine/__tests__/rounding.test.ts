import { describe, expect, it } from "vitest";
import { roundEmblemTotals } from "../formulas";

describe("roundEmblemTotals (standard rounding on summed flats)", () => {
  it("18.6 rounds up to 19 (the documented validation target)", () => {
    expect(roundEmblemTotals({ attack: 18.6 })).toEqual({ attack: 19 });
  });

  it("18.4 rounds down to 18", () => {
    expect(roundEmblemTotals({ attack: 18.4 })).toEqual({ attack: 18 });
  });

  it("handles float artifacts of summed per-emblem values (6 × 3.1)", () => {
    const summed = 3.1 * 6; // 18.599999999999998 in IEEE 754
    expect(roundEmblemTotals({ attack: summed })).toEqual({ attack: 19 });
  });

  it("rounds each stat independently and keeps negatives sane", () => {
    expect(roundEmblemTotals({ hp: -49.6, attack: 2.5, moveSpeed: 34.4 })).toEqual({
      hp: -50,
      attack: 3,
      moveSpeed: 34,
    });
  });

  it("ignores undefined entries", () => {
    expect(roundEmblemTotals({})).toEqual({});
  });
});
