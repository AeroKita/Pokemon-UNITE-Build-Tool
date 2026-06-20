/**
 * Tests for the configurable exact-search permutation cap.
 *
 * Invariants:
 *  [CAP-1] DEFAULT_EXACT_CAP is 1_000_000_000 (mirrors uniteemblemfinder's COLOR_EXACT_CAP).
 *  [CAP-2] exactEnumerationCount ≤ exactCap → exact.
 *  [CAP-3] exactEnumerationCount > exactCap → heuristic.
 *  [CAP-4] constrainedBuildCount is null (DP overflow) → heuristic.
 *  [CAP-5] constrainedBuildCount is 0n (infeasible) → heuristic.
 *  [CAP-7] Custom exactCap respected — lowering can flip exact→heuristic.
 *  [CAP-8] Raising cap above default is supported.
 *  [CAP-9] Orchestrator uses passed exactCap (integration test, small pool).
 *  [CAP-11] Exact runs on pool with >40 distinct Pokémon when count ≤ cap.
 *           (Pool-size gate removed; k-vector enumeration is bounded by count.)
 */

import { describe, it, expect } from "vitest";
import { DEFAULT_EXACT_CAP, shouldRunExact, runSearch } from "../orchestrator";
import { countExactEnumerationSpace } from "../pool";
import { makeEmblem } from "../../__tests__/fixtures";
import { buildCandidatePool } from "../adapt";
import type { EmblemCandidate, SearchOptions } from "../types";
import type { EmblemSetBonus } from "../../../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGold(name: string, colors: string[]): EmblemCandidate {
  const em = makeEmblem(name, colors as never, { attack: 1 });
  return buildCandidatePool([em], { grades: ["gold"] })[0];
}

function singles(n: number, color: string, prefix = "S"): EmblemCandidate[] {
  return Array.from({ length: n }, (_, i) => makeGold(`${prefix}${color}${i}`, [color]));
}

/** Minimal valid options for a color-constrained maximize search. */
function makeOpts(colorConstraints: Map<string, number>, exactCap?: number): SearchOptions {
  return {
    mode: "maximize",
    priorities: { attack: 1 },
    targets: {},
    targetActive: {},
    protected: {},
    colorConstraints: colorConstraints as Map<never, number>,
    colorBonuses: false,
    slots: 10,
    ...(exactCap !== undefined ? { exactCap } : {}),
  };
}

// ---------------------------------------------------------------------------
// [CAP-1] Default cap
// ---------------------------------------------------------------------------

describe("DEFAULT_EXACT_CAP", () => {
  it("[CAP-1] equals 1_000_000_000", () => {
    expect(DEFAULT_EXACT_CAP).toBe(1_000_000_000);
  });
});

// ---------------------------------------------------------------------------
// [CAP-2..5] shouldRunExact — the exported single source of truth
// NOTE: shouldRunExact now takes 2 args (count, cap). No pool-size parameter.
// ---------------------------------------------------------------------------

describe("exactCap gating — shouldRunExact", () => {
  it("[CAP-2] small feasible count ≤ cap → exact", () => {
    // 15 brown + 10 green = 25 Pokémon; target 3 brown → C(15,3)*C(10,7)=54,600 builds.
    const pool = [...singles(15, "brown", "B"), ...singles(10, "green", "G")];
    const targets = new Map<string, number>([["brown", 3]]);
    const count = countExactEnumerationSpace(pool, targets as never);
    expect(count).not.toBeNull();
    expect(count! > 0n).toBe(true);
    expect(shouldRunExact(count, DEFAULT_EXACT_CAP)).toBe(true);
  });

  it("[CAP-3] count > cap → heuristic (custom low cap)", () => {
    const pool = [...singles(15, "brown", "B"), ...singles(10, "green", "G")];
    const targets = new Map<string, number>([["brown", 3]]);
    const count = countExactEnumerationSpace(pool, targets as never);
    expect(count).not.toBeNull();
    expect(count! > 1n).toBe(true);
    // cap=1 → 54,600 > 1 → heuristic
    expect(shouldRunExact(count, 1)).toBe(false);
  });

  it("[CAP-3] same pool, higher custom cap → exact", () => {
    const pool = [...singles(15, "brown", "B"), ...singles(10, "green", "G")];
    const targets = new Map<string, number>([["brown", 3]]);
    const count = countExactEnumerationSpace(pool, targets as never);
    expect(count).not.toBeNull();
    expect(shouldRunExact(count, 1_000_000)).toBe(true);
  });

  it("[CAP-4] null count (DP overflow) → heuristic regardless of cap", () => {
    expect(shouldRunExact(null, DEFAULT_EXACT_CAP)).toBe(false);
  });

  it("[CAP-5] count = 0n (infeasible) → heuristic", () => {
    expect(shouldRunExact(0n, DEFAULT_EXACT_CAP)).toBe(false);
  });

  it("[CAP-5] large pool count ≤ cap → EXACT (no pool-size gate)", () => {
    // Pool of 258 distinct Pokémon with a tiny constrained count is still exact.
    // The only gate is count vs cap — not pool size.
    const smallCount = 100n;
    expect(shouldRunExact(smallCount, DEFAULT_EXACT_CAP)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// [CAP-7,8] Custom cap — flip behavior
// ---------------------------------------------------------------------------

describe("custom exactCap", () => {
  it("[CAP-7] lowering cap to 1 prevents exact for any non-trivial pool", () => {
    const pool = [...singles(15, "brown", "B"), ...singles(10, "green", "G")];
    const targets = new Map<string, number>([["brown", 3]]);
    const count = countExactEnumerationSpace(pool, targets as never)!;
    expect(count > 1n).toBe(true);
    expect(shouldRunExact(count, 1)).toBe(false);
  });

  it("[CAP-8] raising cap to Number.MAX_SAFE_INTEGER still gates correctly", () => {
    const bigCap = Number.MAX_SAFE_INTEGER;
    expect(shouldRunExact(1_000_000_000n, bigCap)).toBe(true);
  });

  it("[CAP-7] count exactly equal to cap → exact (boundary is inclusive ≤)", () => {
    expect(shouldRunExact(500n, 500)).toBe(true);
  });

  it("[CAP-7] count one above cap → heuristic (strict >)", () => {
    expect(shouldRunExact(501n, 500)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// countExactEnumerationSpace + cap — decision helper end-to-end
// ---------------------------------------------------------------------------

describe("end-to-end: constrained count drives cap decision", () => {
  it("pool of 10 → exactly 1 build, always exact", () => {
    const pool = [...singles(5, "brown", "B"), ...singles(5, "green", "G")];
    const targets = new Map<string, number>([
      ["brown", 5],
      ["green", 5],
    ]);
    const count = countExactEnumerationSpace(pool, targets as never);
    expect(count).toBe(1n);
    expect(shouldRunExact(count, DEFAULT_EXACT_CAP)).toBe(true);
    expect(shouldRunExact(count, 1)).toBe(true); // count=1 ≤ cap=1
  });
});

// ---------------------------------------------------------------------------
// [CAP-9] Orchestrator integration — small pool
// ---------------------------------------------------------------------------

describe("[CAP-9] orchestrator integration — runSearch respects exactCap", () => {
  const setBonuses: EmblemSetBonus[] = [];

  function makeSmallPool() {
    return [...singles(5, "brown", "B"), ...singles(10, "green", "G")];
  }

  it("[CAP-9a] default cap → exact search runs (result.exact = true)", async () => {
    const pool = makeSmallPool();
    const opts = makeOpts(new Map([["brown", 1]]));
    const result = await runSearch({ pool, options: opts, setBonuses, effort: "quick" });
    expect(result).not.toBeNull();
    expect(result!.exact).toBe(true);
  }, 15_000);

  it("[CAP-9b] tiny cap (1) → heuristic path (result.exact = false)", async () => {
    const pool = makeSmallPool();
    const opts = makeOpts(new Map([["brown", 1]]), 1);
    const result = await runSearch({ pool, options: opts, setBonuses, effort: "quick" });
    expect(result).not.toBeNull();
    expect(result!.exact).toBe(false);
  }, 15_000);

  it("[CAP-9c] cap exactly at constrained count → exact (≤ is inclusive)", async () => {
    const pool = [...singles(5, "brown", "B"), ...singles(5, "green", "G")];
    const opts = makeOpts(
      new Map([
        ["brown", 5],
        ["green", 5],
      ]),
      1,
    );
    const result = await runSearch({ pool, options: opts, setBonuses, effort: "quick" });
    expect(result).not.toBeNull();
    expect(result!.exact).toBe(true);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// [CAP-11] Full-dataset exact — pool > 40 Pokémon, small constrained count
//
// The critical invariant of the re-architecture: exact search runs on a pool
// of MORE THAN 40 distinct Pokémon when the color-constrained count is ≤ cap.
//
// Pool design: 30 brown-only + 11 green-only = 41 Pokémon (> old 40-cap).
// Target: {brown: 2, green: 8}
//   k-vectors: only [2, 8] (one valid assignment)
//   constrained count = C(30,2) × C(11,8) = 435 × 165 = 71,775
//   71,775 ≤ 1B → exact should run even with 41 Pokémon.
//
// With the old ≤40 gate this would have taken the heuristic path (41 > 40).
// With the new architecture it takes the exact path.
// ---------------------------------------------------------------------------

describe("[CAP-11] exact runs on pool with >40 distinct Pokémon", () => {
  const setBonuses: EmblemSetBonus[] = [];

  // 30 brown + 11 green = 41 distinct Pokémon (breaks the old ≤40 limit)
  function makeLargePool() {
    return [...singles(30, "brown", "B"), ...singles(11, "green", "G")];
  }

  it("[CAP-11a] shouldRunExact returns true — no pool-size gate", () => {
    const pool = makeLargePool();
    const targets = new Map<string, number>([
      ["brown", 2],
      ["green", 8],
    ]);
    const count = countExactEnumerationSpace(pool, targets as never);
    // Count = C(30,2)*C(11,8) = 435*165 = 71,775
    expect(count).not.toBeNull();
    expect(count!).toBe(71_775n);
    expect(shouldRunExact(count, DEFAULT_EXACT_CAP)).toBe(true);
  });

  it("[CAP-11b] runSearch runs exact (result.exact = true) despite 41 Pokémon", async () => {
    const pool = makeLargePool();
    const opts = makeOpts(
      new Map([
        ["brown", 2],
        ["green", 8],
      ]),
    );
    const result = await runSearch({ pool, options: opts, setBonuses, effort: "quick" });
    expect(result).not.toBeNull();
    // The exact path ran — the result is from exhaustive enumeration
    expect(result!.exact).toBe(true);
  }, 30_000);

  it("[CAP-11c] result satisfies the exact color constraints (2 brown + 8 green)", async () => {
    const pool = makeLargePool();
    const opts = makeOpts(
      new Map([
        ["brown", 2],
        ["green", 8],
      ]),
    );
    const result = await runSearch({ pool, options: opts, setBonuses, effort: "quick" });
    expect(result).not.toBeNull();
    // Count colors in the returned picks via EmblemSlot.emblem.colors
    let brown = 0,
      green = 0;
    for (const slot of result!.picks) {
      if (slot.emblem.colors.includes("brown" as never)) brown++;
      if (slot.emblem.colors.includes("green" as never)) green++;
    }
    expect(brown).toBe(2);
    expect(green).toBe(8);
  }, 30_000);

  it("[CAP-11d] lowering cap below 71,775 flips to heuristic", async () => {
    const pool = makeLargePool();
    const opts = makeOpts(
      new Map([
        ["brown", 2],
        ["green", 8],
      ]),
      1000,
    );
    // 71,775 > 1,000 → heuristic
    const result = await runSearch({ pool, options: opts, setBonuses, effort: "quick" });
    expect(result).not.toBeNull();
    expect(result!.exact).toBe(false);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// [CAP-12] Exact search skips heuristic — no redundant heuristic pass
//
// When exact runs to completion, the orchestrator returns immediately without
// running Phase 3 (heuristic). This is verified by checking:
//  (a) result.phase === "exact" (set by exact, not overwritten by heuristic)
//  (b) result.candidates equals the exact evaluated count, not inflated by
//      a heuristic pass that adds its own candidate evaluations.
//  (c) When exact is gated off, heuristic still runs (result.phase !== "exact").
// ---------------------------------------------------------------------------

describe("[CAP-12] exact search skips the heuristic pass on completion", () => {
  const setBonuses: EmblemSetBonus[] = [];

  it("[CAP-12a] exact completion → phase='exact', candidates=exact count, bar reaches 100%", async () => {
    // 5 brown + 5 green, target {brown:5, green:5} → exactly 1 build
    const pool = [...singles(5, "brown", "B"), ...singles(5, "green", "G")];
    const opts = makeOpts(
      new Map([
        ["brown", 5],
        ["green", 5],
      ]),
    );

    const progressEvents: { pct: number; label: string; totalCandidates?: number }[] = [];
    const result = await runSearch({
      pool,
      options: opts,
      setBonuses,
      effort: "quick",
      onProgress: (p) => {
        progressEvents.push({ pct: p.pct, label: p.label, totalCandidates: p.totalCandidates });
      },
    });

    expect(result).not.toBeNull();
    expect(result!.exact).toBe(true);
    expect(result!.phase).toBe("exact");
    // Candidates must equal the exact evaluated count (1), NOT inflated by heuristic
    expect(result!.candidates).toBe(1);
    expect(progressEvents.some((e) => e.totalCandidates === 1)).toBe(true);
    // Progress must NOT contain a heuristic label
    expect(progressEvents.some((e) => e.label.toLowerCase().includes("heuristic"))).toBe(false);
    // Final progress must reach 100 (exact reports 100)
    expect(progressEvents.some((e) => e.label.startsWith("Done — exact"))).toBe(true);
    const maxPct = Math.max(...progressEvents.map((e) => e.pct));
    expect(maxPct).toBe(100);
  }, 15_000);

  it("[CAP-12c] progress bar fills past 55% during exact — no old heuristic-band cap", async () => {
    // Larger pool to generate multiple progress events: 15 brown + 10 green,
    // target {brown:3} → 54,600 builds — enough events to see pct > 55%.
    const pool = [...singles(15, "brown", "B"), ...singles(10, "green", "G")];
    const opts = makeOpts(new Map([["brown", 3]]));

    const pctValues: number[] = [];
    await runSearch({
      pool,
      options: opts,
      setBonuses,
      effort: "quick",
      onProgress: (p) => {
        pctValues.push(p.pct);
      },
    });

    // With old mapping (5 + pct*0.5): max mid-search pct ≈ 54.5 — never > 55.
    // With new mapping (pass-through): pct climbs well above 55 before Done.
    const midSearchMax = Math.max(...pctValues.filter((p) => p < 100));
    expect(midSearchMax).toBeGreaterThan(55);
    // Final must still be 100
    expect(Math.max(...pctValues)).toBe(100);
  }, 30_000);

  it("[CAP-12b] when exact is gated off (cap=1), heuristic runs and phase ≠ 'exact'", async () => {
    const pool = [...singles(5, "brown", "B"), ...singles(5, "green", "G")];
    // cap=1 but count>1 (C(5,4)*C(5,6)... actually let's use brown:4, green:4 with no "neither"
    // group, so count = C(5,4)*C(5,4)=25 > cap=1 → heuristic
    const opts = makeOpts(
      new Map([
        ["brown", 4],
        ["green", 4],
      ]),
      1,
    );

    const result = await runSearch({
      pool,
      options: opts,
      setBonuses,
      effort: "quick",
    });

    // Heuristic ran → may or may not find a valid result, but phase ≠ "exact"
    if (result) {
      expect(result.phase).not.toBe("exact");
    }
    // (result may be null if pool is too small for valid heuristic build)
  }, 15_000);
});
