import { describe, it, expect } from "vitest";
import { emblems } from "../../../data/gameData";
import { buildCandidatePool } from "../adapt";
import { predictFlatStatRanges } from "../predictStats";

const pool = buildCandidatePool(emblems, { grades: ["gold"] });

describe("predictFlatStatRanges", () => {
  it("returns nothing without positive priorities", () => {
    expect(predictFlatStatRanges(pool, {})).toEqual([]);
    expect(predictFlatStatRanges(pool, { attack: 0 })).toEqual([]);
  });

  it("returns nothing when the pool is too small for a full build", () => {
    expect(predictFlatStatRanges(pool.slice(0, 5), { attack: 3 })).toEqual([]);
  });

  it("reports a numeric predicted total for prioritized stats", () => {
    const out = predictFlatStatRanges(pool, { attack: 3, hp: 1 });
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) {
      expect(Number.isFinite(p.predicted)).toBe(true);
    }
    expect(out.map((p) => p.stat)).toContain("attack");
  });

  it("satisfies an active color shell in the predicted build", () => {
    // With a white shell forced, the prediction should reflect HP from white
    // emblems (white carries HP for most +HP emblems) rather than ignoring it.
    const white = new Map([["white", 6] as const]);
    const withShell = predictFlatStatRanges(pool, { attack: 3, hp: 1 }, 5, white);
    const free = predictFlatStatRanges(pool, { attack: 3, hp: 1 });
    const hpShell = withShell.find((p) => p.stat === "hp")?.predicted ?? 0;
    const hpFree = free.find((p) => p.stat === "hp")?.predicted ?? 0;
    expect(hpShell).toBeGreaterThanOrEqual(hpFree);
  });

  it("orders results by weight (highest first) and caps the count", () => {
    const out = predictFlatStatRanges(
      pool,
      { attack: 3, hp: 2.5, defense: 2, spDefense: 1.5, critRate: 1, cdr: 0.5 },
      3,
    );
    expect(out).toHaveLength(3);
    expect(out[0].weight).toBeGreaterThanOrEqual(out[1].weight);
    expect(out[1].weight).toBeGreaterThanOrEqual(out[2].weight);
  });

  it("predicts a higher flat total for a stat as its weight dominates", () => {
    const low = predictFlatStatRanges(pool, { attack: 5, hp: 0.5 }).find((p) => p.stat === "hp");
    const high = predictFlatStatRanges(pool, { attack: 0.5, hp: 5 }).find((p) => p.stat === "hp");
    if (low && high) {
      expect(high.predicted).toBeGreaterThanOrEqual(low.predicted);
    }
  });

  it("alsoReport includes zero-weight stats from the same greedy build", () => {
    const out = predictFlatStatRanges(pool, { attack: 3, hp: 1 }, 5, undefined, ["moveSpeed"]);
    const move = out.find((p) => p.stat === "moveSpeed");
    expect(move).toBeDefined();
    expect(move!.weight).toBe(0);
    expect(Number.isFinite(move!.predicted)).toBe(true);
  });
});
