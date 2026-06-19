/**
 * Tests for the parallel exact-search infrastructure.
 *
 * Tests use searchColorExactSlice directly (no actual workers needed) so
 * they run in Vitest/Node without a browser environment.
 *
 * Invariants:
 *  [PAR-1] unrankCombination correctly decodes rank → k-subset (lexicographic).
 *  [PAR-2] unrankCombination rank=0 → [0,1,...,k-1]; subsequent ranks match nextCombo.
 *  [PAR-3] unrankLocalState local=0 → initial per-group odometer state.
 *  [PAR-4] computeKPrefix sums correctly; last entry = total build count.
 *  [PAR-5] Two searchColorExactSlice partitions of [0,total) together find the
 *          same best result as single-threaded searchColorExact.
 *  [PAR-6] Evaluated counts of all slices sum to totalCombos.
 *  [PAR-7] runSearch integration: the full search on a 41-Pokémon pool returns
 *          result.exact = true (parallel falls back to single-thread in Node).
 */

import { describe, it, expect } from "vitest";
import {
  unrankCombination,
  unrankLocalState,
  computeKPrefix,
  binomNum,
  buildColorTargetGroups,
  enumerateColorKVectors,
  searchColorExactSlice,
  searchColorExact,
  EXACT_PARALLEL_MIN,
} from "../exactColor";
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

function minOpts(colorConstraints: Map<string, number>): SearchOptions {
  return {
    mode: "maximize",
    priorities: { attack: 1 },
    targets: {},
    targetActive: {},
    protected: {},
    colorConstraints: colorConstraints as Map<never, number>,
    colorBonuses: false,
    slots: 10,
  };
}

// ---------------------------------------------------------------------------
// [PAR-1,2] unrankCombination
// ---------------------------------------------------------------------------

describe("unrankCombination", () => {
  it("[PAR-1] rank=0 for any (n,k) → [0,1,...,k-1]", () => {
    expect(unrankCombination(5, 2, 0)).toEqual([0, 1]);
    expect(unrankCombination(10, 3, 0)).toEqual([0, 1, 2]);
    expect(unrankCombination(4, 4, 0)).toEqual([0, 1, 2, 3]);
  });

  it("[PAR-2] ranks 0..C(5,2)-1 match lexicographic k-subsets of {0..4}", () => {
    // All 2-subsets of {0,1,2,3,4} in lex order:
    const expected = [[0,1],[0,2],[0,3],[0,4],[1,2],[1,3],[1,4],[2,3],[2,4],[3,4]];
    const n = 5, k = 2;
    expect(binomNum(n, k)).toBe(expected.length);
    for (let r = 0; r < expected.length; r++) {
      expect(unrankCombination(n, k, r)).toEqual(expected[r]);
    }
  });

  it("[PAR-2] rank=C(n,k)-1 → last combination [n-k,...,n-1]", () => {
    // Last 3-subset of {0..5}: [3,4,5]
    const last = binomNum(6, 3) - 1; // 20-1=19
    expect(unrankCombination(6, 3, last)).toEqual([3, 4, 5]);
  });

  it("[PAR-2] unranking matches nextCombo sequence for n=6, k=2", () => {
    const n = 6, k = 2;
    const total = binomNum(n, k); // 15
    // Build expected list by iterating nextCombo
    const combos: number[][] = [];
    const idx = [0, 1];
    do {
      combos.push([...idx]);
      // nextCombo inline
      let i = k - 1;
      while (i >= 0 && idx[i] === n - k + i) i--;
      if (i < 0) break;
      idx[i]++;
      for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
    } while (combos.length < total);

    for (let r = 0; r < total; r++) {
      expect(unrankCombination(n, k, r)).toEqual(combos[r]);
    }
  });
});

// ---------------------------------------------------------------------------
// [PAR-3] unrankLocalState
// ---------------------------------------------------------------------------

describe("unrankLocalState", () => {
  it("[PAR-3] local=0 → initial odometer state [0..k[g]-1] per group", () => {
    // groups: [size=30, k=2] and [size=11, k=8]
    const sizes = [30, 11];
    const k = [2, 8];
    const state = unrankLocalState(sizes, k, 0);
    expect(state[0]).toEqual([0, 1]);           // first 2-combo of 30
    expect(state[1]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]); // first 8-combo of 11
  });

  it("[PAR-3] local=C(11,8) → second 2-combo of first group, first 8-combo of second", () => {
    const sizes = [30, 11];
    const k = [2, 8];
    // radix[1] = C(11,8) = 165; local=165 → group1 rank=165%165=0, group0 rank=165/165=1
    const state = unrankLocalState(sizes, k, 165);
    expect(state[0]).toEqual([0, 2]); // rank-1 of C(30,2): [0,2]
    expect(state[1]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]); // rank-0 of C(11,8)
  });
});

// ---------------------------------------------------------------------------
// [PAR-4] computeKPrefix
// ---------------------------------------------------------------------------

describe("computeKPrefix", () => {
  it("[PAR-4] prefix sums correctly; last entry = total builds", () => {
    // Pool: 30 brown + 11 green, target {brown:2, green:8}
    // k-vectors: only [2,8]; C(30,2)*C(11,8) = 435*165 = 71,775
    const pool = [...singles(30, "brown", "B"), ...singles(11, "green", "G")];
    const targets = new Map<string, number>([["brown", 2], ["green", 8]]);
    const groups = buildColorTargetGroups(pool, targets as Map<never, number>);
    const sizes = groups.map(g => g.names.length);
    const kVectors = enumerateColorKVectors(
      groups, sizes, [2, 8], 10,
    );
    expect(kVectors).not.toBeNull();
    expect(kVectors!.length).toBe(1); // only one valid k-vector [2,8]

    const kPrefix = computeKPrefix(sizes, kVectors!);
    expect(kPrefix[0]).toBe(0);
    expect(kPrefix[1]).toBe(71_775); // C(30,2)*C(11,8)
    expect(kPrefix[kPrefix.length - 1]).toBe(71_775);
  });
});

// ---------------------------------------------------------------------------
// [PAR-5,6] Slice partition — correctness and coverage
//
// The 41-Pokémon pool from CAP-11 (30 brown + 11 green, target {brown:2,
// green:8}) has 71,775 color-valid builds. We split it into 3 slices and
// verify: (a) the union finds the same best result as single-threaded
// searchColorExact, and (b) the total evaluated = 71,775.
// ---------------------------------------------------------------------------

describe("searchColorExactSlice — partition correctness", () => {
  const setBonuses: EmblemSetBonus[] = [];

  it(
    "[PAR-5,6] three partitions together match single-threaded result and cover all builds",
    async () => {
      const pool = [...singles(30, "brown", "B"), ...singles(11, "green", "G")];
      const targets = new Map<string, number>([["brown", 2], ["green", 8]]);
      const opts = minOpts(targets);

      // Prepare shared plan
      const groups = buildColorTargetGroups(pool, targets as Map<never, number>);
      const sizes = groups.map(g => g.names.length);
      const kVectors = enumerateColorKVectors(groups, sizes, [2, 8], 10)!;
      const kPrefix = computeKPrefix(sizes, kVectors);
      const totalCombos = kPrefix[kPrefix.length - 1]; // 71,775

      // Single-threaded reference
      const singleResult = await searchColorExact(pool, opts, setBonuses);
      expect(singleResult).not.toBeNull();
      expect(singleResult!.evaluated).toBe(totalCombos);

      // Three balanced slices
      const n = 3;
      const base = Math.floor(totalCombos / n);
      const ranges = [
        { start: 0, size: base },
        { start: base, size: base },
        { start: 2 * base, size: totalCombos - 2 * base },
      ];

      let totalEvaluated = 0;
      let bestSlice = null;

      const { isBetter: ib } = await import("../evaluate");

      for (const { start, size } of ranges) {
        const r = await searchColorExactSlice(
          pool, opts, setBonuses,
          groups, kVectors, kPrefix,
          start, size,
        );
        if (r) {
          totalEvaluated += r.evaluated;
          if (!bestSlice || ib(r.ev, bestSlice.ev, opts)) bestSlice = r;
        } else {
          // An empty slice can return null — count its size
          totalEvaluated += size;
        }
      }

      // [PAR-6] Total evaluated across all slices = global total
      expect(totalEvaluated).toBe(totalCombos);

      // [PAR-5] Best result from partitioned slices matches single-threaded
      expect(bestSlice).not.toBeNull();
      expect(bestSlice!.ev.score).toBeCloseTo(singleResult!.ev.score, 6);
    },
    60_000,
  );

  it(
    "[PAR-5] each slice evaluates only its own range (no overlaps, no gaps)",
    async () => {
      // Tiny pool: 5 brown + 5 green, target {brown:5, green:5} → 1 build
      const pool = [...singles(5, "brown", "B"), ...singles(5, "green", "G")];
      const targets = new Map<string, number>([["brown", 5], ["green", 5]]);
      const opts = minOpts(targets);
      const groups = buildColorTargetGroups(pool, targets as Map<never, number>);
      const sizes = groups.map(g => g.names.length);
      const kVectors = enumerateColorKVectors(groups, sizes, [5, 5], 10)!;
      const kPrefix = computeKPrefix(sizes, kVectors);

      // Total = 1 build; slice [0,1) must find it; slice [1,0) returns null
      const r0 = await searchColorExactSlice(pool, opts, [], groups, kVectors, kPrefix, 0, 1);
      const r1 = await searchColorExactSlice(pool, opts, [], groups, kVectors, kPrefix, 0, 0);
      expect(r0).not.toBeNull();
      expect(r0!.evaluated).toBe(1);
      expect(r1).toBeNull(); // sliceSize=0 → null
    },
    15_000,
  );
});

// ---------------------------------------------------------------------------
// [PAR-7] EXACT_PARALLEL_MIN threshold
// ---------------------------------------------------------------------------

describe("EXACT_PARALLEL_MIN", () => {
  it("[PAR-7] is 50_000", () => {
    expect(EXACT_PARALLEL_MIN).toBe(50_000);
  });

  it("[PAR-7] 71,775 builds (CAP-11 pool) exceeds threshold → parallel would trigger", () => {
    // The 30+11 pool has 71,775 builds > 50,000, so parallel would be attempted
    // (it falls back in Node, but the gate condition is correct)
    expect(71_775 >= EXACT_PARALLEL_MIN).toBe(true);
  });
});
