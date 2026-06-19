/**
 * Core evaluate / score functions for the emblem search engine.
 *
 * Provenance: clean-room TypeScript reimplementation inspired by evaluate()
 * and related helpers in uniteemblemfinder.github.io search_worker.js.
 */

import type { EmblemColor, EmblemSetBonus, StatBlock } from "../../types";
import type { EmblemCandidate, PokemonScoringContext, SearchOptions, StatWeights } from "./types";

export const SCORE_EPS = 1e-9;

// ---------------------------------------------------------------------------
// Stat normalization (for scoring, not for raw stat totals)
// Matches STAT_VALUE_SCALE in recommend.ts so scoring is on comparable scale.
// ---------------------------------------------------------------------------

/** Per-stat normalization divisor: normalises raw flat values to ~0..1 range. */
export const STAT_NORM: Record<keyof StatBlock, number> = {
  hp: 200,
  attack: 14,
  defense: 14,
  spAttack: 14,
  spDefense: 14,
  critRate: 0.04,
  cdr: 0.08,
  lifesteal: 0.05,
  spLifesteal: 0.05,
  attackSpeed: 0.09,
  moveSpeed: 150,
};

const PROTECT_PENALTY_WEIGHT = 45;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sum raw flat stats across all candidates. */
export function sumStats(candidates: EmblemCandidate[]): Partial<StatBlock> {
  const out: Partial<StatBlock> = {};
  for (const c of candidates) {
    for (const [k, v] of Object.entries(c.stats) as [keyof StatBlock, number][]) {
      out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}

/**
 * Count colors per slot.
 * Because the search enforces distinct Pokémon names, this equals FoxForge's
 * dedupe-by-pokemonName countColors for any valid loadout.
 */
export function countColorsRaw(candidates: EmblemCandidate[]): Map<EmblemColor, number> {
  const map = new Map<EmblemColor, number>();
  for (const c of candidates) {
    for (const col of c.colors) {
      map.set(col, (map.get(col) ?? 0) + 1);
    }
  }
  return map;
}

/** Check whether the color counts exactly match all specified targets. */
export function colorsMatchTargets(
  counts: Map<EmblemColor, number>,
  targets: Map<EmblemColor, number> | null,
): boolean {
  if (!targets) return true;
  for (const [color, need] of targets) {
    if ((counts.get(color) ?? 0) !== need) return false;
  }
  return true;
}

/**
 * Compute a color-bonus incentive score from the active set bonuses.
 * Encourages the search to reach higher bonus tiers; does NOT compute actual
 * effective stats (that's pokemonScore.ts).
 */
export function colorBonusIncentive(
  counts: Map<EmblemColor, number>,
  setBonuses: EmblemSetBonus[],
): number {
  let score = 0;
  for (const def of setBonuses) {
    const n = counts.get(def.color) ?? 0;
    let best = 0;
    for (const [thresh, pct] of Object.entries(def.thresholds)) {
      if (n >= Number(thresh) && pct > 0) best = Math.max(best, pct);
    }
    // Scale bonus incentive by stat importance (~attack/spAttack bonuses are most valuable)
    score += best * 100; // pct → points
  }
  return score;
}

/**
 * Pokémon-aware color-bonus incentive (inner-loop proxy).
 *
 * Scales each set bonus by: (base[stat] × bonusPct) / STAT_NORM[stat] × weight.
 *
 * This is the key insight: a 4% brown Attack bonus on Lucario (base ~300)
 * yields +12 attack, worth ~0.86 normalised units; on a Pokémon with base ~150
 * attack it yields only +6 (0.43 units). So % bonuses are correctly valued MORE
 * on high-base Pokémon relative to flat stat gains.
 *
 * Precomputes from the static baseStats vector — no per-candidate allocations.
 */
/**
 * Baseline value for survivability set bonuses (HP %, Defense %, Sp.Def %) so
 * the defensive half of a meta color shell is rewarded even when the role gives
 * the stat no explicit priority weight (e.g. white/HP on a pure Attacker). The
 * actual priority weight wins when higher; offensive bonuses get no such floor
 * so off-role offense colors are not over-valued. Negative-threshold utility
 * colors (pink/navy/gray) never reach here — their bestPct stays 0.
 */
const SURVIVAL_SET_BONUS_FLOOR: Partial<Record<keyof StatBlock, number>> = {
  hp: 0.5,
  defense: 0.4,
  spDefense: 0.4,
};

function pokemonAwareColorBonus(
  counts: Map<EmblemColor, number>,
  setBonuses: EmblemSetBonus[],
  ctx: PokemonScoringContext,
  weights: StatWeights,
): number {
  let score = 0;
  for (const def of setBonuses) {
    const n = counts.get(def.color) ?? 0;
    let bestPct = 0;
    for (const [thresh, pct] of Object.entries(def.thresholds)) {
      if (n >= Number(thresh) && pct > 0) bestPct = Math.max(bestPct, pct);
    }
    if (bestPct === 0) continue;
    const stat = def.stat as keyof StatBlock;
    const weight = Math.max(weights[stat] ?? 0, SURVIVAL_SET_BONUS_FLOOR[stat] ?? 0);
    if (weight <= 0) continue;
    const base = ctx.baseStats[stat] ?? 0;
    const norm = STAT_NORM[stat] ?? 1;
    // Absolute effective-stat gain from this set bonus, normalised and weighted
    score += (base * bestPct / norm) * weight;
  }
  return score;
}

/** Target-mode stat tolerance: percentage stats use 0.05, others 0.51. */
function targetTol(stat: keyof StatBlock): number {
  return stat === "critRate" || stat === "cdr" ? 0.05 : 0.51;
}

// ---------------------------------------------------------------------------
// Evaluate
// ---------------------------------------------------------------------------

export interface EvalResult {
  valid: boolean;
  score: number;
  error?: number;
  totals: Partial<StatBlock>;
  colorCounts: Map<EmblemColor, number>;
}

/**
 * Evaluate a candidate loadout.
 *
 * Returns valid=false if color constraints are not met. Otherwise scores the
 * loadout in maximize or target mode.
 *
 * This is the hot-path function called 10k–100k times per search; it operates
 * on raw flat stats (no base-stat stacking) for speed. Pokémon-aware scoring
 * via computeEffectiveStats is applied only to the final result.
 */
export function evaluateLoadout(
  candidates: EmblemCandidate[],
  opts: SearchOptions,
  setBonuses: EmblemSetBonus[],
): EvalResult {
  const totals = sumStats(candidates);
  const colorCounts = countColorsRaw(candidates);

  if (!colorsMatchTargets(colorCounts, opts.colorConstraints)) {
    return { valid: false, score: -1e12, totals, colorCounts };
  }

  if (opts.mode === "maximize") {
    let score = 0;

    // Weighted flat stats
    for (const [stat, weight] of Object.entries(opts.priorities) as [keyof StatBlock, number][]) {
      const v = totals[stat] ?? 0;
      if (weight) score += (v / (STAT_NORM[stat] ?? 1)) * weight;
    }

    // Optional color-bonus incentive
    if (opts.colorBonuses) {
      if (opts.scoringMode === "pokemon" && opts.pokemonContext) {
        // Pokémon-aware: scale % bonuses by actual base stats at the chosen level.
        // Already normalised — no extra 0.01 factor needed.
        score += pokemonAwareColorBonus(colorCounts, setBonuses, opts.pokemonContext, opts.priorities);
      } else {
        score += colorBonusIncentive(colorCounts, setBonuses) * 0.01;
      }
    }

    // Protect floors penalty
    for (const [stat, floor] of Object.entries(opts.protected) as [keyof StatBlock, number][]) {
      const v = totals[stat] ?? 0;
      if (v < floor - SCORE_EPS) {
        score -= (floor - v) / (STAT_NORM[stat] ?? 1) * PROTECT_PENALTY_WEIGHT;
      }
    }

    return { valid: true, score, totals, colorCounts };
  }

  // Target mode: accumulate total error
  let error = 0;
  for (const [stat, active] of Object.entries(opts.targetActive) as [keyof StatBlock, boolean][]) {
    if (!active) continue;
    const target = opts.targets[stat] ?? 0;
    const actual = totals[stat] ?? 0;
    const diff = Math.abs(actual - target);
    const tol = targetTol(stat);
    if (diff > tol) error += (diff / (STAT_NORM[stat] ?? 1));
  }

  // Protect floor penalty even in target mode
  for (const [stat, floor] of Object.entries(opts.protected) as [keyof StatBlock, number][]) {
    const v = totals[stat] ?? 0;
    if (v < floor - SCORE_EPS) {
      error += (floor - v) / (STAT_NORM[stat] ?? 1) * PROTECT_PENALTY_WEIGHT;
    }
  }

  return { valid: true, score: -error, error, totals, colorCounts };
}

/** Quick greedy per-candidate value estimate (used for sort order during seed building). */
export function candidateGreedyValue(c: EmblemCandidate, opts: SearchOptions): number {
  let v = 0;
  for (const [stat, weight] of Object.entries(opts.priorities) as [keyof StatBlock, number][]) {
    const raw = c.stats[stat] ?? 0;
    if (weight) v += (raw / (STAT_NORM[stat] ?? 1)) * weight;
  }
  for (const [stat, floor] of Object.entries(opts.protected) as [keyof StatBlock, number][]) {
    const raw = c.stats[stat] ?? 0;
    if (raw < floor - SCORE_EPS) {
      v -= (floor - raw) / (STAT_NORM[stat] ?? 1) * PROTECT_PENALTY_WEIGHT;
    }
  }
  return v;
}

/** True if ev is strictly better than bestEv under the current opts. */
export function isBetter(
  ev: EvalResult,
  bestEv: EvalResult | null,
  opts: SearchOptions,
): boolean {
  if (!ev.valid) return false;
  if (!bestEv || !bestEv.valid) return true;
  if (opts.mode === "target") {
    const a = ev.error ?? Infinity;
    const b = bestEv.error ?? Infinity;
    return a < b - SCORE_EPS;
  }
  return ev.score > bestEv.score + SCORE_EPS;
}
