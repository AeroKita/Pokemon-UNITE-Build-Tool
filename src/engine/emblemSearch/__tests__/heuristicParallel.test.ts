/**
 * Tests for the parallel heuristic coordinator's pure helpers.
 *
 * The worker-spawning path can't run in Vitest/Node (no DOM Worker), so these
 * tests cover the framework-agnostic pieces: result merging and shard-count
 * gating. In Node, runHeuristicParallel returns null and the orchestrator
 * falls back to single-threaded runHeuristic (asserted indirectly elsewhere).
 *
 * Invariants:
 *  [HPAR-1] mergeHeuristicResults picks the best ev (maximize) across shards.
 *  [HPAR-2] mergeHeuristicResults picks the lowest error (target mode).
 *  [HPAR-3] mergeHeuristicResults sums candidate + try counts across shards.
 *  [HPAR-4] mergeHeuristicResults returns null when no shard produced a result.
 *  [HPAR-5] heuristicShardCount returns 0 when navigator is unavailable (Node).
 *  [HPAR-6] runHeuristicParallel resolves null when Worker is unavailable.
 */

import { describe, it, expect } from "vitest";
import {
  mergeHeuristicResults,
  heuristicShardCount,
  runHeuristicParallel,
} from "../heuristicParallel";
import type { HeuristicResult } from "../heuristic";
import type { EvalResult } from "../evaluate";
import type { EmblemCandidate, SearchOptions } from "../types";

function ev(partial: Partial<EvalResult>): EvalResult {
  return {
    valid: true,
    score: 0,
    totals: {},
    colorCounts: new Map(),
    ...partial,
  };
}

function res(evResult: EvalResult, candidates: number, tries: number): HeuristicResult {
  return { loadout: [], ev: evResult, candidates, tries };
}

const maximizeOpts: SearchOptions = {
  mode: "maximize",
  priorities: { attack: 1 },
  targets: {},
  targetActive: {},
  protected: {},
  colorConstraints: null,
  colorBonuses: false,
  slots: 10,
};

const targetOpts: SearchOptions = { ...maximizeOpts, mode: "target" };

describe("mergeHeuristicResults", () => {
  it("[HPAR-1] picks the highest score in maximize mode", () => {
    const merged = mergeHeuristicResults(
      [res(ev({ score: 10 }), 100, 3), res(ev({ score: 25 }), 200, 5), res(ev({ score: 18 }), 150, 4)],
      [100, 200, 150],
      maximizeOpts,
    );
    expect(merged?.ev.score).toBe(25);
  });

  it("[HPAR-2] picks the lowest error in target mode", () => {
    const merged = mergeHeuristicResults(
      [res(ev({ score: 0, error: 5 }), 100, 3), res(ev({ score: 0, error: 1 }), 200, 5)],
      [100, 200],
      targetOpts,
    );
    expect(merged?.ev.error).toBe(1);
  });

  it("[HPAR-3] sums candidate and try counts across all shards", () => {
    const merged = mergeHeuristicResults(
      [res(ev({ score: 10 }), 100, 3), res(ev({ score: 25 }), 200, 5)],
      [100, 200],
      maximizeOpts,
    );
    expect(merged?.candidates).toBe(300);
    expect(merged?.tries).toBe(8);
  });

  it("[HPAR-3] counts evaluated work even from shards with null results", () => {
    const merged = mergeHeuristicResults(
      [res(ev({ score: 10 }), 100, 3), null],
      [100, 40],
      maximizeOpts,
    );
    expect(merged?.candidates).toBe(140);
    expect(merged?.ev.score).toBe(10);
  });

  it("[HPAR-4] returns null when no shard produced a result", () => {
    expect(mergeHeuristicResults([null, null], [10, 20], maximizeOpts)).toBeNull();
  });
});

describe("heuristicShardCount", () => {
  it("[HPAR-5] returns 0 when navigator is unavailable (Node test env)", () => {
    // jsdom may define navigator; only assert the Node contract when it's absent.
    if (typeof navigator === "undefined") {
      expect(heuristicShardCount()).toBe(0);
    } else {
      // With a navigator, it must never exceed the 8-shard cap and be >= 0.
      const n = heuristicShardCount();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(8);
    }
  });
});

describe("runHeuristicParallel", () => {
  it("[HPAR-6] resolves null when Worker is unavailable", async () => {
    const pool: EmblemCandidate[] = [];
    const result = await runHeuristicParallel(pool, maximizeOpts, [], "normal");
    expect(result).toBeNull();
  });
});
