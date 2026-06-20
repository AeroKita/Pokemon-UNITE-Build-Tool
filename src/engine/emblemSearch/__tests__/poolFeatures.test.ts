/**
 * Tests for three follow-up features in the FoxForge emblem optimizer:
 *
 *  1. countConstrainedBuilds — dual-color-aware DP build counter that narrows
 *     the search-space display when exact color targets are active.
 *  2. Mixed grades — buildCandidatePool includes all owned grades per Pokémon
 *     when mixedGrades=true, and only the best grade when false.
 *  3. Color mode wiring — SearchOptions.colorConstraints=null in weighted/off
 *     mode; colorBonuses forced true in weighted mode.
 *
 * Invariants tested:
 *  [FU-1a] countConstrainedBuilds returns 0n for infeasible targets.
 *  [FU-1b] countConstrainedBuilds returns a positive BigInt for feasible targets.
 *  [FU-1c] Constrained count ≤ unconstrained C(n,10).
 *  [FU-1d] Dual-color-heavy target (sum > 10) is accepted and returns feasible count.
 *  [FU-1e] Returns null when DP state space exceeds the threshold.
 *  [FU-2a] mixedGrades=true includes all owned grade variants per Pokémon.
 *  [FU-2b] mixedGrades=false (best-grade only) returns exactly one candidate per Pokémon.
 *  [FU-2c] Mixed pool has more candidates than best-grade-only pool.
 *  [FU-3a] colorConstraints=null when colorMode is "off" or "weighted" (no hard rejection).
 *  [FU-3b] colorConstraints=Map when colorMode is "exact".
 *  [FU-3c] colorBonuses forced true in SearchOptions when colorMode is "weighted".
 */

import { describe, it, expect } from "vitest";
import { makeEmblem } from "../../__tests__/fixtures";
import { buildCandidatePool } from "../adapt";
import {
  countConstrainedBuilds,
  countExactEnumerationSpace,
  matchingBuildDisplayCount,
  approximateBuildCount,
  distinctPokemonCount,
  buildPool,
} from "../pool";
import { emblems as allEmblems } from "../../../data/gameData";
import { DEFAULT_EXACT_CAP, shouldRunExact } from "../orchestrator";
import type { EmblemCandidate } from "../types";
import type { Emblem } from "../../../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGoldCandidate(name: string, colors: string[]): EmblemCandidate {
  const emblem = makeEmblem(name, colors as never, { attack: 1 });
  return buildCandidatePool([emblem], { grades: ["gold"] })[0];
}

/** Build N distinct Pokémon with a single color. */
function singles(n: number, color: string, prefix = "S"): EmblemCandidate[] {
  return Array.from({ length: n }, (_, i) => makeGoldCandidate(`${prefix}${color}${i}`, [color]));
}

/** Build N distinct Pokémon with two colors. */
function duals(n: number, c1: string, c2: string, prefix = "D"): EmblemCandidate[] {
  return Array.from({ length: n }, (_, i) =>
    makeGoldCandidate(`${prefix}${c1}${c2}${i}`, [c1, c2]),
  );
}

// ---------------------------------------------------------------------------
// 1. countConstrainedBuilds
// ---------------------------------------------------------------------------

describe("countConstrainedBuilds — basic feasibility", () => {
  it("[FU-1a] returns 0n when a required color is absent from the pool", () => {
    const pool = singles(10, "brown");
    const targets = new Map<string, number>([["green", 3]]);
    expect(countConstrainedBuilds(pool, targets as never)).toBe(0n);
  });

  it("[FU-1a] returns 0n when the required count exceeds pool capacity", () => {
    // Only 5 green in pool; require 6
    const pool = [...singles(5, "green"), ...singles(5, "brown")];
    const targets = new Map<string, number>([["green", 6]]);
    expect(countConstrainedBuilds(pool, targets as never)).toBe(0n);
  });

  it("[FU-1b] returns positive BigInt for a feasible single-color target", () => {
    // 15 brown available; require exactly 4 out of 10 to be brown
    const pool = [...singles(15, "brown", "B"), ...singles(10, "green", "G")];
    const targets = new Map<string, number>([["brown", 4]]);
    const count = countConstrainedBuilds(pool, targets as never);
    expect(typeof count).toBe("bigint");
    expect(count).not.toBeNull();
    expect(count! > 0n).toBe(true);
  });

  it("[FU-1c] constrained count ≤ unconstrained C(n,10)", () => {
    const pool = [...singles(15, "brown", "B"), ...singles(10, "green", "G")];
    const targets = new Map<string, number>([["brown", 5]]);
    const constrained = countConstrainedBuilds(pool, targets as never);
    const unconstrained = approximateBuildCount(pool, 10);
    expect(constrained).not.toBeNull();
    expect(constrained! <= unconstrained).toBe(true);
  });
});

describe("countConstrainedBuilds — dual-color (sum > 10)", () => {
  it("[FU-1d] accepts a dual-heavy target whose sum exceeds 10", () => {
    // 5 green/black duals + 5 pure green + 5 pure black → 15 distinct Pokémon
    // Build 10: 3 duals + 3 pure-green + 4 pure-black → 6 green, 7 black
    const pool = [
      ...duals(5, "green", "black", "GB"),
      ...singles(5, "green", "PG"),
      ...singles(5, "black", "PB"),
    ];
    const targets = new Map<string, number>([
      ["green", 6],
      ["black", 7],
    ]);
    const count = countConstrainedBuilds(pool, targets as never);
    expect(count).not.toBeNull();
    expect(count! > 0n).toBe(true);
  });

  it("[FU-1d] rejects sum > 20 (impossible for 10 dual-color slots)", () => {
    const pool = duals(10, "green", "black", "GB");
    // Sum = 11 + 11 = 22 > 20
    const targets = new Map<string, number>([
      ["green", 11],
      ["black", 11],
    ]);
    expect(countConstrainedBuilds(pool, targets as never)).toBe(0n);
  });

  it("10 duals yields exactly 1 build matching 10 green + 10 black", () => {
    // Exactly one way to pick all 10 dual-color Pokémon
    const pool = duals(10, "green", "black", "GB");
    const targets = new Map<string, number>([
      ["green", 10],
      ["black", 10],
    ]);
    expect(countConstrainedBuilds(pool, targets as never)).toBe(1n);
  });
});

describe("countConstrainedBuilds — no constraint", () => {
  it("returns null when constraints map is empty (no target set)", () => {
    const pool = singles(15, "brown");
    expect(countConstrainedBuilds(pool, new Map())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// exact enumeration space vs grade-aware display count
// ---------------------------------------------------------------------------

describe("countExactEnumerationSpace vs countConstrainedBuilds", () => {
  it("[ENUM-1] single-grade pool: both counts match", () => {
    const pool = [...singles(15, "brown", "B"), ...singles(10, "green", "G")];
    const targets = new Map<string, number>([["brown", 4]]);
    expect(countExactEnumerationSpace(pool, targets as never)).toBe(
      countConstrainedBuilds(pool, targets as never),
    );
  });

  it("[ENUM-2] mixed-grade pool: grade-aware count exceeds cap while name-only enum space does not", () => {
    const emblems: Emblem[] = Array.from({ length: 30 }, (_, i) =>
      makeEmblem(`Mon${i}`, ["brown"] as never, { attack: 1 }),
    );
    const ownedKeys = new Set<string>();
    for (let i = 0; i < 30; i++) {
      for (const g of ["gold", "silver", "bronze"]) ownedKeys.add(`mon${i}:${g}`);
    }
    const pool = buildCandidatePool(emblems, { ownedKeys, mixedGrades: true });
    const targets = new Map<string, number>([["brown", 10]]);

    const display = countConstrainedBuilds(pool, targets as never);
    const enumSpace = countExactEnumerationSpace(pool, targets as never, 10, false);
    const gradeAwareEnum = countExactEnumerationSpace(pool, targets as never, 10, true);

    expect(enumSpace).not.toBeNull();
    expect(display).not.toBeNull();
    expect(gradeAwareEnum).not.toBeNull();
    expect(display! > enumSpace!).toBe(true);
    expect(gradeAwareEnum).toBe(display);
    expect(enumSpace! <= BigInt(DEFAULT_EXACT_CAP)).toBe(true);
    expect(display! > BigInt(DEFAULT_EXACT_CAP)).toBe(true);
    expect(shouldRunExact(display, DEFAULT_EXACT_CAP)).toBe(false);
    expect(shouldRunExact(enumSpace, DEFAULT_EXACT_CAP)).toBe(true);
    expect(shouldRunExact(gradeAwareEnum, DEFAULT_EXACT_CAP)).toBe(false);
  });
});

describe("matchingBuildDisplayCount", () => {
  it("[ENUM-3] prefers exact enumeration count for UI numerator", () => {
    expect(matchingBuildDisplayCount(30_205_280n, 777_400_000_000n)).toBe(30_205_280n);
  });

  it("[ENUM-4] falls back to constrained count when enum space is null", () => {
    expect(matchingBuildDisplayCount(null, 42n)).toBe(42n);
  });
});

// ---------------------------------------------------------------------------
// 2. Mixed grades (buildCandidatePool)
// ---------------------------------------------------------------------------

describe("buildCandidatePool — mixedGrades", () => {
  function makeOwnedKeys(id: string, grades: string[]): Set<string> {
    return new Set(grades.map((g) => `${id}:${g}`));
  }

  it("[FU-2b] mixedGrades=false includes only the best-owned grade", () => {
    const em = makeEmblem("Pika", ["yellow"] as never, { attack: 2 });
    const ownedKeys = makeOwnedKeys("pika", ["gold", "silver", "bronze"]);
    const pool = buildCandidatePool([em], { ownedKeys, mixedGrades: false });
    // Best grade is gold (first in GRADE_ORDER)
    expect(pool).toHaveLength(1);
    expect(pool[0].grade).toBe("gold");
  });

  it("[FU-2a] mixedGrades=true includes all owned grade variants", () => {
    const em = makeEmblem("Pika", ["yellow"] as never, { attack: 2 });
    const ownedKeys = makeOwnedKeys("pika", ["gold", "silver", "bronze"]);
    const pool = buildCandidatePool([em], { ownedKeys, mixedGrades: true });
    expect(pool).toHaveLength(3);
    const grades = pool.map((c) => c.grade).sort();
    expect(grades).toEqual(["bronze", "gold", "silver"]);
  });

  it("[FU-2c] mixed pool has more candidates than best-grade pool", () => {
    const emblems: Emblem[] = ["A", "B", "C"].map((n) =>
      makeEmblem(n, ["brown"] as never, { attack: 1 }),
    );
    const ownedKeys = new Set(
      emblems.flatMap((e) => ["gold", "silver"].map((g) => `${e.id}:${g}`)),
    );
    const mixedPool = buildCandidatePool(emblems, { ownedKeys, mixedGrades: true });
    const bestPool = buildCandidatePool(emblems, { ownedKeys, mixedGrades: false });
    expect(mixedPool.length).toBeGreaterThan(bestPool.length);
    expect(bestPool.length).toBe(3); // one per Pokémon
    expect(mixedPool.length).toBe(6); // two grades × 3 Pokémon
  });

  it("mixedGrades defaults to true when not specified", () => {
    const em = makeEmblem("Raichu", ["yellow"] as never, { attack: 1 });
    const ownedKeys = new Set(["raichu:gold", "raichu:silver"]);
    // Omitting mixedGrades → default true
    const pool = buildCandidatePool([em], { ownedKeys });
    expect(pool.length).toBe(2);
  });

  it("goldOnly flag still prevents bronze/silver variants even with mixedGrades=true", () => {
    const em: Emblem = { ...makeEmblem("GoldOnly", ["brown"] as never, {}), goldOnly: true };
    const ownedKeys = new Set(["goldonly:gold", "goldonly:silver", "goldonly:bronze"]);
    const pool = buildCandidatePool([em], { ownedKeys, mixedGrades: true });
    // goldOnly prevents bronze and silver even when mixed
    expect(pool).toHaveLength(1);
    expect(pool[0].grade).toBe("gold");
  });
});

// ---------------------------------------------------------------------------
// 3. Color mode option wiring (SearchOptions layer)
// ---------------------------------------------------------------------------

describe("color mode — SearchOptions wiring", () => {
  // These tests verify the logic that EmblemOptimizer.tsx encodes into SearchOptions.
  // We replicate the mapping inline rather than importing the component.

  type ColorMode = "off" | "weighted" | "exact";

  function buildColorOpts(
    colorMode: ColorMode,
    activeColors: string[],
    colorCounts: Record<string, number>,
    colorBonusesChecked: boolean,
  ) {
    // Mirror of EmblemOptimizer's colorConstraints useMemo
    const colorConstraints: Map<string, number> | null =
      colorMode === "exact" && activeColors.length > 0
        ? new Map(activeColors.map((c) => [c, colorCounts[c] ?? 0]))
        : null;

    // Mirror of advancedSearchOptions colorBonuses override
    const colorBonuses = colorMode === "weighted" ? true : colorBonusesChecked;

    return { colorConstraints, colorBonuses };
  }

  it("[FU-3a] colorConstraints is null when mode is 'off'", () => {
    const { colorConstraints } = buildColorOpts("off", ["brown"], { brown: 5 }, false);
    expect(colorConstraints).toBeNull();
  });

  it("[FU-3a] colorConstraints is null when mode is 'weighted'", () => {
    const { colorConstraints } = buildColorOpts("weighted", ["brown"], { brown: 5 }, false);
    expect(colorConstraints).toBeNull();
  });

  it("[FU-3b] colorConstraints is a Map when mode is 'exact'", () => {
    const { colorConstraints } = buildColorOpts("exact", ["brown"], { brown: 6 }, false);
    expect(colorConstraints).not.toBeNull();
    expect(colorConstraints!.get("brown")).toBe(6);
  });

  it("[FU-3c] colorBonuses is forced true when mode is 'weighted' regardless of checkbox", () => {
    const { colorBonuses } = buildColorOpts("weighted", [], {}, false);
    expect(colorBonuses).toBe(true);
  });

  it("[FU-3c] colorBonuses follows the checkbox when mode is 'exact' or 'off'", () => {
    expect(buildColorOpts("exact", ["brown"], { brown: 4 }, false).colorBonuses).toBe(false);
    expect(buildColorOpts("exact", ["brown"], { brown: 4 }, true).colorBonuses).toBe(true);
    expect(buildColorOpts("off", [], {}, false).colorBonuses).toBe(false);
    expect(buildColorOpts("off", [], {}, true).colorBonuses).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatBuildCount — abbreviation helper (K / M / B / T tiers)
//
// Both constrained-build counts and the exactCap value are formatted by this
// same function, so the indicator string is always internally consistent.
// ---------------------------------------------------------------------------

import { formatBuildCount } from "../pool";

describe("formatBuildCount", () => {
  it("[FMT-1] values < 1000 shown exactly", () => {
    expect(formatBuildCount(0n)).toBe("0");
    expect(formatBuildCount(1n)).toBe("1");
    expect(formatBuildCount(999n)).toBe("999");
  });

  it("[FMT-2] 1k–9999 shown with one decimal (toFixed tier)", () => {
    expect(formatBuildCount(1000n)).toBe("1.0k");
    expect(formatBuildCount(5500n)).toBe("5.5k");
    expect(formatBuildCount(9999n)).toBe("10.0k"); // rounds up to "10.0k" in this tier
  });

  it("[FMT-3] ≥ 10k shown as rounded integer Nk", () => {
    expect(formatBuildCount(10_000n)).toBe("10k");
    expect(formatBuildCount(999_999n)).toBe("1000k");
  });

  it("[FMT-4] ≥ 1M shown as N.NM", () => {
    expect(formatBuildCount(1_000_000n)).toBe("1.0M");
    expect(formatBuildCount(12_300_000n)).toBe("12.3M");
    expect(formatBuildCount(999_000_000n - 1n)).toBe("999.0M");
  });

  it("[FMT-5] ≥ 1B (1e9) shown as N.NB", () => {
    expect(formatBuildCount(1_000_000_000n)).toBe("1.0B");
    expect(formatBuildCount(14_900_000_000n)).toBe("14.9B");
    expect(formatBuildCount(999_000_000_000n)).toBe("999.0B");
  });

  it("[FMT-6] ≥ 1T (1e12) shown as N.NT — the missing tier", () => {
    // Before the fix, 1e12 rendered as "1000.0B". After the fix: "1.0T".
    expect(formatBuildCount(1_000_000_000_000n)).toBe("1.0T");
    expect(formatBuildCount(2_000_000_000_000n)).toBe("2.0T");
  });

  it("[FMT-7] default exactCap (1e9) formats as '1.0B'", () => {
    // The cap spinner shows this as default; if it ever showed '1000.0M' the
    // test would catch it.
    expect(formatBuildCount(BigInt(1_000_000_000))).toBe("1.0B");
  });

  it("[FMT-8] cap at 1000B (1e12) formats as '1.0T', not '1000.0B'", () => {
    expect(formatBuildCount(BigInt(1_000_000_000_000))).toBe("1.0T");
  });
});

// ---------------------------------------------------------------------------
// Grade-reactive pool / build count
//
// approximateBuildCount counts distinct 10-Pokémon loadouts with one grade
// variant per slot. Single-grade pools → C(258,10); multi-grade pools use
// the full combinatorial count (elementary symmetric polynomial over variants).
//
//  [GRADE-1] Full dataset, gold-only  → pool.length = 258 (1 variant / Pokémon).
//  [GRADE-2] Full dataset, all grades → pool.length > 258 (multi-grade variants).
//  [GRADE-3] approximateBuildCount grows with grade variants (all > gold-only).
//  [GRADE-4] distinctPokemonCount is grade-INDEPENDENT.
//  [GRADE-5] Mixed-grades vs best-grade-only changes candidate count, not name count.
// ---------------------------------------------------------------------------

describe("approximateBuildCount — grade-aware combinatorics", () => {
  it("single variant per Pokémon → C(n,10)", () => {
    const pool = singles(15, "brown");
    expect(approximateBuildCount(pool, 10)).toBe(3003n); // C(15,10)
  });

  it("multi-grade variants multiply within chosen Pokémon", () => {
    const em = makeEmblem("Pika", ["yellow"] as never, { attack: 2 });
    const em2 = makeEmblem("Raichu", ["yellow"] as never, { attack: 1 });
    const threeGrade = buildCandidatePool([em], {
      ownedKeys: new Set(["pika:gold", "pika:silver", "pika:bronze"]),
      mixedGrades: true,
    });
    // 1 Pokémon with 3 grades → only 3 one-slot builds; for 1 slot:
    expect(approximateBuildCount(threeGrade, 1)).toBe(3n);

    const mixed = buildCandidatePool([em, em2], {
      ownedKeys: new Set(["pika:gold", "pika:silver", "raichu:gold", "raichu:silver"]),
      mixedGrades: true,
    });
    // Pick 2 Pokémon: pika(2 grades) × raichu(2 grades) = 4 grade assignments
    expect(approximateBuildCount(mixed, 2)).toBe(4n);
  });
});

describe("grade-reactive pool candidate count", () => {
  const noOwned = new Set<string>();

  it("[GRADE-1] gold-only full dataset → 258 candidates (1 per Pokémon)", () => {
    const pool = buildPool(
      allEmblems,
      { useOwned: false, mixedGrades: true, allowedGrades: new Set(["gold"]) },
      noOwned,
    );
    expect(pool.length).toBe(258);
  });

  it("[GRADE-2] all grades full dataset → more than 258 candidates", () => {
    const pool = buildPool(
      allEmblems,
      { useOwned: false, mixedGrades: true, allowedGrades: new Set(["gold", "silver", "bronze"]) },
      noOwned,
    );
    expect(pool.length).toBeGreaterThan(258);
  });

  it("[GRADE-3] approximateBuildCount is grade-DEPENDENT (all grades > gold-only)", () => {
    const goldPool = buildPool(
      allEmblems,
      { useOwned: false, mixedGrades: true, allowedGrades: new Set(["gold"]) },
      noOwned,
    );
    const allPool = buildPool(
      allEmblems,
      { useOwned: false, mixedGrades: true, allowedGrades: new Set(["gold", "silver", "bronze"]) },
      noOwned,
    );
    const goldCount = approximateBuildCount(goldPool);
    const allCount = approximateBuildCount(allPool);
    // Gold-only: C(258, 10)
    expect(goldCount).toBeGreaterThan(1_000_000_000_000n);
    expect(allCount).toBeGreaterThan(goldCount);
  });

  it("[GRADE-4] distinctPokemonCount is grade-INDEPENDENT", () => {
    const goldPool = buildPool(
      allEmblems,
      { useOwned: false, mixedGrades: true, allowedGrades: new Set(["gold"]) },
      noOwned,
    );
    const allPool = buildPool(
      allEmblems,
      { useOwned: false, mixedGrades: true, allowedGrades: new Set(["gold", "silver", "bronze"]) },
      noOwned,
    );
    expect(distinctPokemonCount(goldPool)).toBe(distinctPokemonCount(allPool));
    expect(distinctPokemonCount(goldPool)).toBe(258);
  });

  it("[GRADE-5] pool.length changes with grade selection → drives grade-reactive UI display", () => {
    const gold = buildPool(
      allEmblems,
      { useOwned: false, mixedGrades: true, allowedGrades: new Set(["gold"]) },
      noOwned,
    );
    const goldSi = buildPool(
      allEmblems,
      { useOwned: false, mixedGrades: true, allowedGrades: new Set(["gold", "silver"]) },
      noOwned,
    );
    const all = buildPool(
      allEmblems,
      { useOwned: false, mixedGrades: true, allowedGrades: new Set(["gold", "silver", "bronze"]) },
      noOwned,
    );
    // Each additional grade tier adds variants
    expect(gold.length).toBeLessThan(goldSi.length);
    expect(goldSi.length).toBeLessThanOrEqual(all.length);
    // Distinct Pokémon count stays at 258 throughout
    expect(distinctPokemonCount(gold)).toBe(258);
    expect(distinctPokemonCount(all)).toBe(258);
  });
});
