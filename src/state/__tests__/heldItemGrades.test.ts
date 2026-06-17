import { describe, expect, it } from "vitest";
import {
  clampHeldGrade,
  gradeForHeldItem,
  resolveSlotGrades,
} from "../heldItemGrades";
import { emptyLoadout } from "../loadout";

describe("heldItemGrades memory", () => {
  it("clamps grades to 1–40", () => {
    expect(clampHeldGrade(0)).toBe(1);
    expect(clampHeldGrade(99)).toBe(40);
    expect(clampHeldGrade(13.4)).toBe(13);
  });

  it("defaults to grade 40 when unset", () => {
    expect(gradeForHeldItem({}, "muscle-band")).toBe(40);
    expect(gradeForHeldItem({ "muscle-band": 13 }, "muscle-band")).toBe(13);
  });

  it("resolves slot grades from global memory", () => {
    const loadout = {
      ...emptyLoadout(),
      heldItemIds: ["muscle-band", "score-shield", null] as [string | null, string | null, string | null],
    };
    const memory = { "muscle-band": 13, "score-shield": 20 };
    expect(resolveSlotGrades(loadout, memory)).toEqual([13, 20, 40]);
  });
});
