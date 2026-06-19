/**
 * Deterministic flat-stat prediction from priority weights.
 *
 * Answers the user-facing question "what flat emblem stats will these priority
 * sliders actually produce?" without running the full search. It greedily builds
 * the best 10 distinct-Pokémon loadout for the given weights (the same ranking
 * the search seeds from) and reports each prioritized stat's flat total.
 *
 * When color targets are active it satisfies them first (mirroring the real
 * search's color shell) so the estimate reflects the constrained outcome rather
 * than an unconstrained one — keeping the prediction close to what the search
 * returns. It is still a fast estimate (greedy, no hill-climb/SA/exact), so the
 * search may do marginally better, but the figure is a confident point estimate
 * rather than a wide range.
 */

import type { EmblemCandidate } from "./types";
import type { EmblemColor, StatBlock } from "../../types";
import { STAT_NORM } from "./evaluate";

const SLOTS = 10;

export interface FlatStatPrediction {
  stat: keyof StatBlock;
  weight: number;
  /** Predicted flat total for this stat in the greedy best-weighted build. */
  predicted: number;
}

/** Greedily pick up to SLOTS distinct-Pokémon candidates from a pre-sorted (best-first) list. */
function greedyPick(
  sorted: EmblemCandidate[],
  colorTargets: Map<EmblemColor, number> | undefined,
): EmblemCandidate[] {
  const seen = new Set<string>();
  const picked: EmblemCandidate[] = [];

  // Phase 1: satisfy active color targets first, preferring the highest-scored
  // emblems that cover an unmet color (sorted is already best-weighted first).
  if (colorTargets && colorTargets.size > 0) {
    const need = new Map(colorTargets);
    const needLeft = () => [...need.values()].reduce((a, b) => a + Math.max(0, b), 0);
    while (picked.length < SLOTS && needLeft() > 0) {
      let chosen: EmblemCandidate | null = null;
      let chosenCoverage = 0;
      for (const c of sorted) {
        if (seen.has(c.pokemonName)) continue;
        const coverage = c.colors.filter((col) => (need.get(col) ?? 0) > 0).length;
        if (coverage > chosenCoverage) {
          chosen = c;
          chosenCoverage = coverage;
          // sorted is score-descending, so the first max-coverage hit is best-scored
        }
      }
      if (!chosen) break;
      seen.add(chosen.pokemonName);
      picked.push(chosen);
      for (const col of chosen.colors) if (need.has(col)) need.set(col, (need.get(col) ?? 0) - 1);
    }
  }

  // Phase 2: fill the remaining slots with the best-scored distinct candidates.
  for (const c of sorted) {
    if (picked.length >= SLOTS) break;
    if (seen.has(c.pokemonName)) continue;
    seen.add(c.pokemonName);
    picked.push(c);
  }
  return picked;
}

function sumStat(build: EmblemCandidate[], stat: keyof StatBlock): number {
  let total = 0;
  for (const c of build) total += c.stats[stat] ?? 0;
  return total;
}

/**
 * Predict flat emblem-stat totals from priority weights.
 *
 * @param pool          Candidate emblems (one entry per emblem+grade).
 * @param priorities    Stat weights (only positive weights are reported).
 * @param maxStats      Cap on how many stats to report (highest-weighted first).
 * @param colorTargets  Active color counts to satisfy first (optional). Pass the
 *                      Advanced color shell so the estimate matches the search.
 * @param alsoReport    Extra stats to report from the same greedy build even when
 *                      their priority weight is 0 — e.g. moveSpeed when a protect
 *                      floor is active but the role gives the stat no weight.
 */
export function predictFlatStatRanges(
  pool: EmblemCandidate[],
  priorities: Partial<Record<keyof StatBlock, number>>,
  maxStats = 5,
  colorTargets?: Map<EmblemColor, number>,
  alsoReport: ReadonlyArray<keyof StatBlock> = [],
): FlatStatPrediction[] {
  if (pool.length < SLOTS) return [];

  const weighted = (Object.entries(priorities) as [keyof StatBlock, number][])
    .filter(([, w]) => w > 0);
  if (weighted.length === 0 && alsoReport.length === 0) return [];

  const weightedScore = (c: EmblemCandidate): number => {
    let v = 0;
    for (const [stat, w] of weighted) {
      v += ((c.stats[stat] ?? 0) / (STAT_NORM[stat] ?? 1)) * w;
    }
    return v;
  };
  const sorted = [...pool].sort((a, b) => weightedScore(b) - weightedScore(a));
  const build = greedyPick(sorted, colorTargets);

  const reported = new Set<keyof StatBlock>();
  const out: FlatStatPrediction[] = weighted
    .sort(([, a], [, b]) => b - a)
    .slice(0, maxStats)
    .map(([stat, weight]) => {
      reported.add(stat);
      return { stat, weight, predicted: sumStat(build, stat) };
    });

  for (const stat of alsoReport) {
    if (reported.has(stat)) continue;
    reported.add(stat);
    out.push({ stat, weight: priorities[stat] ?? 0, predicted: sumStat(build, stat) });
  }

  return out;
}
