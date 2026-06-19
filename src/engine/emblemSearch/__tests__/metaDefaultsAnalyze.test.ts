import { describe, expect, it } from "vitest";
import { metaMobilityScore, pickBestVariant, type VariantResult } from "../../../../tools/meta-defaults/analyze";

describe("metaMobilityScore", () => {
  it("penalises negative net move speed", () => {
    const withNeg = metaMobilityScore(-70, 18.32);
    const neutral = metaMobilityScore(0, 18.15);
    expect(neutral).toBeGreaterThan(withNeg);
  });

  it("rewards positive move speed slightly", () => {
    const pos = metaMobilityScore(35, 18.0);
    const zero = metaMobilityScore(0, 18.0);
    expect(pos).toBeGreaterThan(zero);
  });
});

describe("pickBestVariant", () => {
  const variants: VariantResult[] = [
    {
      kind: "current",
      label: "current",
      score: 18.32,
      totals: {},
      moveSpeed: -70,
      hp: 500,
      negMoveSpeedPicks: ["Rhyhorn(gold)"],
    },
    {
      kind: "mobility_floor",
      label: "+floor",
      score: 18.15,
      totals: {},
      moveSpeed: 0,
      hp: 450,
      negMoveSpeedPicks: [],
    },
  ];

  it("prefers mobility floor when it fixes negative move speed", () => {
    const rec = pickBestVariant(variants, 0, { defense: -5 });
    expect(rec.kind).toBe("mobility_floor");
    expect(rec.suggestedFloors.moveSpeed).toBe(0);
  });
});
