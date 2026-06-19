/**
 * Tests for the proposed color set-bonus preview helpers.
 *
 * Key invariants:
 *  1. A color whose count meets a threshold returns the correct tier + percent.
 *  2. Colors with only negative bonuses (e.g. pink) are excluded.
 *  3. A count below ALL thresholds yields no entry for that color.
 *  4. concreteBonusDelta correctly distinguishes multiplied vs percent-point stats.
 *  5. Multiple active colors each produce their own entry.
 *  6. Count exactly at a boundary tier returns that tier, not the next.
 */

import { describe, it, expect } from "vitest";
import {
  proposedColorBonuses,
  concreteBonusDelta,
  type ColorBonusPreviewItem,
} from "../colorBonusPreview";
import type { EmblemSetBonus } from "../../../types";

// ---------------------------------------------------------------------------
// Fixture set-bonus data (matches patch-1.23.1.1.json structure)
// ---------------------------------------------------------------------------

const TEST_SET_BONUSES: EmblemSetBonus[] = [
  { color: "brown", stat: "attack",   thresholds: { 2: 0.01, 4: 0.02, 6: 0.04 } },
  { color: "green", stat: "spAttack", thresholds: { 2: 0.01, 4: 0.02, 6: 0.04 } },
  { color: "blue",  stat: "defense",  thresholds: { 2: 0.02, 4: 0.04, 6: 0.08 } },
  { color: "black", stat: "cdr",      thresholds: { 3: 0.01, 5: 0.02, 7: 0.04 } },
  { color: "red",   stat: "attackSpeed", thresholds: { 3: 0.02, 5: 0.04, 7: 0.08 } },
  // pink has NEGATIVE bonus — should be filtered out
  { color: "pink",  stat: "hp",       thresholds: { 3: -0.04, 5: -0.08, 7: -0.16 } },
];

// ---------------------------------------------------------------------------
// proposedColorBonuses
// ---------------------------------------------------------------------------

describe("proposedColorBonuses", () => {
  it("[PREV-1] empty counts → empty result", () => {
    const result = proposedColorBonuses(new Map(), TEST_SET_BONUSES);
    expect(result).toHaveLength(0);
  });

  it("[PREV-2] count below lowest threshold → no entry", () => {
    // brown threshold starts at 2; count 1 is below it
    const result = proposedColorBonuses(new Map([["brown", 1]]), TEST_SET_BONUSES);
    expect(result).toHaveLength(0);
  });

  it("[PREV-3] count exactly at tier-1 threshold → tier 1", () => {
    const result = proposedColorBonuses(new Map([["brown", 2]]), TEST_SET_BONUSES);
    expect(result).toHaveLength(1);
    const b = result[0];
    expect(b.color).toBe("brown");
    expect(b.tier).toBe(1);
    expect(b.percent).toBeCloseTo(0.01);
    expect(b.percentPoint).toBe(false);
  });

  it("[PREV-4] count at tier-2 boundary → tier 2, correct percent", () => {
    const result = proposedColorBonuses(new Map([["brown", 4]]), TEST_SET_BONUSES);
    expect(result[0].tier).toBe(2);
    expect(result[0].percent).toBeCloseTo(0.02);
  });

  it("[PREV-5] count at tier-3 threshold → tier 3 (highest)", () => {
    const result = proposedColorBonuses(new Map([["brown", 6]]), TEST_SET_BONUSES);
    expect(result[0].tier).toBe(3);
    expect(result[0].percent).toBeCloseTo(0.04);
  });

  it("[PREV-6] count exceeds highest threshold → still tier 3", () => {
    // 9 brown still gives the same tier-3 bonus
    const result = proposedColorBonuses(new Map([["brown", 9]]), TEST_SET_BONUSES);
    expect(result[0].tier).toBe(3);
    expect(result[0].percent).toBeCloseTo(0.04);
  });

  it("[PREV-7] negative-bonus color (pink) is excluded", () => {
    const result = proposedColorBonuses(new Map([["pink", 7]]), TEST_SET_BONUSES);
    expect(result).toHaveLength(0);
  });

  it("[PREV-8] percent-point stat (cdr / black) sets percentPoint=true", () => {
    const result = proposedColorBonuses(new Map([["black", 3]]), TEST_SET_BONUSES);
    expect(result[0].percentPoint).toBe(true);
    expect(result[0].stat).toBe("cdr");
    expect(result[0].tier).toBe(1);
  });

  it("[PREV-9] attackSpeed (red) is also a percent-point stat", () => {
    const result = proposedColorBonuses(new Map([["red", 5]]), TEST_SET_BONUSES);
    expect(result[0].percentPoint).toBe(true);
    expect(result[0].stat).toBe("attackSpeed");
  });

  it("[PREV-10] multiple active colors → one entry each", () => {
    const counts = new Map<import("../../../types").EmblemColor, number>([
      ["brown", 6],
      ["blue",  4],
      ["green", 2],
    ]);
    const result = proposedColorBonuses(counts, TEST_SET_BONUSES);
    expect(result).toHaveLength(3);
    const colors = result.map((r) => r.color);
    expect(colors).toContain("brown");
    expect(colors).toContain("blue");
    expect(colors).toContain("green");
  });

  it("[PREV-11] color not in setBonuses → not in result", () => {
    // navy has no set bonus in our fixture (and not in TEST_SET_BONUSES)
    const result = proposedColorBonuses(new Map([["navy", 6]]), TEST_SET_BONUSES);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// concreteBonusDelta
// ---------------------------------------------------------------------------

describe("concreteBonusDelta", () => {
  const baseItem = (
    stat: ColorBonusPreviewItem["stat"],
    percent: number,
    percentPoint: boolean,
  ): ColorBonusPreviewItem => ({
    color: "brown",
    count: 6,
    stat,
    percent,
    tier: 3,
    percentPoint,
  });

  it("[DELTA-1] multiplied stat: delta = baseStat × percent", () => {
    const item = baseItem("attack", 0.04, false);
    expect(concreteBonusDelta(item, 300)).toBeCloseTo(12);
  });

  it("[DELTA-2] multiplied stat with different base", () => {
    const item = baseItem("hp", 0.04, false);
    expect(concreteBonusDelta(item, 7000)).toBeCloseTo(280);
  });

  it("[DELTA-3] percent-point stat: delta = percent (independent of base)", () => {
    // CDR: +4% CDR regardless of base
    const item = baseItem("cdr", 0.04, true);
    expect(concreteBonusDelta(item, 0)).toBeCloseTo(0.04);
    expect(concreteBonusDelta(item, 100)).toBeCloseTo(0.04); // base ignored
  });

  it("[DELTA-4] attackSpeed percent-point delta", () => {
    const item = baseItem("attackSpeed", 0.08, true);
    // 7 red gives +8% Atk Spd additive, regardless of base
    expect(concreteBonusDelta(item, 0.5)).toBeCloseTo(0.08);
  });

  it("[DELTA-5] zero base stat → multiplied delta is 0", () => {
    const item = baseItem("attack", 0.04, false);
    expect(concreteBonusDelta(item, 0)).toBe(0);
  });
});
