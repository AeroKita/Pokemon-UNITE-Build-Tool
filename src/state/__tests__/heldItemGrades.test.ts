import { describe, expect, it } from "vitest";
import {
  clampHeldGrade,
  gradeForHeldItem,
  parseGradeInput,
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

  it("parseGradeInput accepts 1–40 and rejects invalid input", () => {
    expect(parseGradeInput("5")).toEqual({ digits: "5", valid: true, value: 5 });
    expect(parseGradeInput("40")).toEqual({ digits: "40", valid: true, value: 40 });
    expect(parseGradeInput("41")).toEqual({ digits: "41", valid: false, value: null });
    expect(parseGradeInput("0")).toEqual({ digits: "0", valid: false, value: null });
    expect(parseGradeInput("")).toEqual({ digits: "", valid: false, value: null });
    expect(parseGradeInput("4a")).toEqual({ digits: "4", valid: true, value: 4 });
    expect(parseGradeInput("abc")).toEqual({ digits: "", valid: false, value: null });
  });

  it("resolves slot grades from global memory", () => {
    const loadout = {
      ...emptyLoadout(),
      heldItemIds: ["muscle-band", "score-shield", null] as [
        string | null,
        string | null,
        string | null,
      ],
    };
    const memory = { "muscle-band": 13, "score-shield": 20 };
    expect(resolveSlotGrades(loadout, memory)).toEqual([13, 20, 40]);
  });
});
