/**
 * Recipe-signature solver for target mode.
 *
 * Provenance: clean-room TypeScript port of recipe_search.js from
 * uniteemblemfinder.github.io. The core concept (group emblems by
 * stat signature, DFS to find a valid recipe count assignment) is
 * reimplemented from first principles in TypeScript.
 */

import type { StatBlock } from "../../types";
import type { EmblemCandidate, SearchOptions } from "./types";
import { sumStats, SCORE_EPS } from "./evaluate";

const RECIPE_MAX_TYPES = 56;
const RECIPE_MAX_STEPS = 400_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Round a stat value to the precision used in signatures. */
function roundSigVal(stat: keyof StatBlock, v: number): number {
  if (stat === "hp") return Math.round(v);
  return Math.round(v * 10) / 10;
}

/** Canonical string signature of a set of flat stats. */
function candidateSignature(stats: Partial<StatBlock>): string {
  const parts: string[] = [];
  for (const [stat, v] of Object.entries(stats) as [keyof StatBlock, number][]) {
    if (Math.abs(v) < 1e-9) continue;
    parts.push(`${stat}:${roundSigVal(stat, v)}`);
  }
  return parts.sort().join("|");
}

/** Target tolerance per stat. */
function tol(stat: keyof StatBlock): number {
  return stat === "critRate" || stat === "cdr" ? 0.05 : 0.51;
}

/** Error between actual and target for one active stat. */
function statDelta(stat: keyof StatBlock, actual: number, target: number): number {
  const diff = Math.abs(actual - target);
  return diff <= tol(stat) ? 0 : diff;
}

// ---------------------------------------------------------------------------
// Recipe types
// ---------------------------------------------------------------------------

interface Recipe {
  sig: string;
  /** All candidates that share this stat signature. */
  cands: EmblemCandidate[];
  stats: Partial<StatBlock>;
  /** Number of distinct Pokémon names in this group (limits how many can be used). */
  nameCount: number;
}

// ---------------------------------------------------------------------------
// Build catalog
// ---------------------------------------------------------------------------

function buildSignatureCatalog(pool: EmblemCandidate[]): Map<string, EmblemCandidate[]> {
  const cat = new Map<string, EmblemCandidate[]>();
  for (const c of pool) {
    const sig = candidateSignature(c.stats);
    if (!cat.has(sig)) cat.set(sig, []);
    cat.get(sig)!.push(c);
  }
  return cat;
}

// ---------------------------------------------------------------------------
// Filter & rank recipes
// ---------------------------------------------------------------------------

function isRecipeRelevant(stats: Partial<StatBlock>, opts: SearchOptions): boolean {
  for (const [stat, active] of Object.entries(opts.targetActive) as [keyof StatBlock, boolean][]) {
    if (!active) continue;
    const v = stats[stat] ?? 0;
    const target = opts.targets[stat] ?? 0;
    const t = tol(stat);
    if (Math.abs(v) < 1e-9) continue;
    if (Math.abs(target) <= t) continue;
    if (target > t && v > 0) return true;
    if (target < -t && v < 0) return true;
  }
  return false;
}

function scoreRecipeRelevance(r: Recipe, opts: SearchOptions): number {
  let score = r.nameCount * 8;
  for (const [stat, active] of Object.entries(opts.targetActive) as [keyof StatBlock, boolean][]) {
    if (!active) continue;
    const v = r.stats[stat] ?? 0;
    if (Math.abs(v) < 1e-9) continue;
    const target = opts.targets[stat] ?? 0;
    const t = tol(stat);
    if (Math.abs(target) <= t) continue;
    if ((target > t && v > 0) || (target < -t && v < 0)) {
      score += Math.abs(v);
    }
  }
  return score;
}

function capRecipes(recipes: Recipe[], opts: SearchOptions): Recipe[] {
  recipes.sort(
    (a, b) =>
      scoreRecipeRelevance(b, opts) - scoreRecipeRelevance(a, opts) ||
      b.nameCount - a.nameCount ||
      a.sig.localeCompare(b.sig),
  );
  return recipes.slice(0, RECIPE_MAX_TYPES);
}

// ---------------------------------------------------------------------------
// DFS recipe count solver
// ---------------------------------------------------------------------------

function recipeError(totals: Partial<StatBlock>, opts: SearchOptions): number {
  let err = 0;
  for (const [stat, active] of Object.entries(opts.targetActive) as [keyof StatBlock, boolean][]) {
    if (!active) continue;
    err += statDelta(stat, totals[stat] ?? 0, opts.targets[stat] ?? 0);
  }
  return err;
}

/** Upper/lower bound for how much a set of remaining recipes can add to statId. */
function recipeStatBound(
  remStats: Partial<StatBlock>[],
  stat: keyof StatBlock,
  n: number,
  dir: "max" | "min",
): number {
  const vals = remStats.map((s) => s[stat] ?? 0);
  if (dir === "max") vals.sort((a, b) => b - a);
  else vals.sort((a, b) => a - b);
  let sum = 0;
  for (let i = 0; i < n && i < vals.length; i++) sum += vals[i];
  return sum;
}

function canStillReach(
  totals: Partial<StatBlock>,
  recipes: Recipe[],
  idx: number,
  used: number,
  slots: number,
  opts: SearchOptions,
): boolean {
  const need = slots - used;
  if (need <= 0) return true;
  const rem = recipes.slice(idx).map((r) => r.stats);
  if (rem.length < need) return false;
  for (const [stat, active] of Object.entries(opts.targetActive) as [keyof StatBlock, boolean][]) {
    if (!active) continue;
    const target = opts.targets[stat] ?? 0;
    const t = tol(stat);
    const cur = totals[stat] ?? 0;
    const lo = target - t;
    const hi = target + t;
    const maxReach = cur + recipeStatBound(rem, stat, need, "max");
    const minReach = cur + recipeStatBound(rem, stat, need, "min");
    if (maxReach < lo - 1e-9 || minReach > hi + 1e-9) return false;
  }
  return true;
}

interface SolvedRecipe {
  counts: number[];
  error: number;
  recipes: Recipe[];
  capped: boolean;
}

function solveRecipeCounts(
  recipes: Recipe[],
  opts: SearchOptions,
  slots: number,
  shouldAbort?: () => boolean,
): SolvedRecipe | null {
  if (!recipes.length) return null;
  let bestCounts: number[] | null = null;
  let bestErr = Infinity;
  const counts = new Array<number>(recipes.length).fill(0);
  const totals: Partial<StatBlock> = {};
  for (const r of recipes) {
    for (const k of Object.keys(r.stats) as (keyof StatBlock)[]) totals[k] = 0;
  }
  let steps = 0;
  let aborted = false;

  function addRecipe(idx: number, k: number, sign: 1 | -1) {
    const st = recipes[idx].stats;
    for (const [key, v] of Object.entries(st) as [keyof StatBlock, number][]) {
      totals[key] = (totals[key] ?? 0) + sign * v * k;
    }
  }

  function dfs(idx: number, used: number) {
    if (shouldAbort?.()) { aborted = true; return; }
    if (++steps > RECIPE_MAX_STEPS) { aborted = true; return; }
    if (bestErr <= SCORE_EPS) return;

    if (idx === recipes.length) {
      if (used !== slots) return;
      const err = recipeError(totals, opts);
      if (err < bestErr - SCORE_EPS) {
        bestErr = err;
        bestCounts = counts.slice();
      }
      return;
    }

    if (!canStillReach(totals, recipes, idx, used, slots, opts)) return;

    const remaining = slots - used;
    const maxK = Math.min(remaining, recipes[idx].nameCount);
    for (let k = maxK; k >= 0; k--) {
      counts[idx] = k;
      addRecipe(idx, k, 1);
      dfs(idx + 1, used + k);
      addRecipe(idx, k, -1);
      counts[idx] = 0;
      if (aborted || bestErr <= SCORE_EPS) return;
    }
  }

  dfs(0, 0);
  if (!bestCounts) return null;
  return { counts: bestCounts, error: bestErr, recipes, capped: aborted };
}

// ---------------------------------------------------------------------------
// Assign from recipe counts → actual candidates
// ---------------------------------------------------------------------------

function shuffle<T>(arr: T[]): T[] {
  return arr.slice().sort(() => Math.random() - 0.5);
}

function assignFromCounts(
  solved: SolvedRecipe,
  slots: number,
  opts: SearchOptions,
): EmblemCandidate[] | null {
  const { counts, recipes } = solved;
  const result: EmblemCandidate[] = [];
  const names = new Set<string>();
  const order = recipes
    .map((r, i) => ({ r, n: counts[i] }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);

  for (const { r, n } of order) {
    const variants = shuffle(r.cands);
    let picked = 0;
    for (const c of variants) {
      if (picked >= n) break;
      if (names.has(c.pokemonName)) continue;
      result.push(c);
      names.add(c.pokemonName);
      picked++;
    }
    if (picked < n) return null;
  }
  if (result.length !== slots) return null;

  // Quick target-error check
  const totals = sumStats(result);
  let valid = true;
  for (const [stat, active] of Object.entries(opts.targetActive) as [keyof StatBlock, boolean][]) {
    if (!active) continue;
    if (statDelta(stat, totals[stat] ?? 0, opts.targets[stat] ?? 0) > SCORE_EPS * 10) {
      valid = false;
      break;
    }
  }
  return valid ? result : null;
}

function polishLoadout(
  loadout: EmblemCandidate[],
  pool: EmblemCandidate[],
  opts: SearchOptions,
): { loadout: EmblemCandidate[]; error: number } {
  let best = loadout.slice();
  let bestErr = recipeError(sumStats(best), opts);
  const tries = Math.min(120, pool.length);
  for (let t = 0; t < tries; t++) {
    const slot = Math.floor(Math.random() * best.length);
    const names = new Set(best.map((x, i) => (i === slot ? null : x.pokemonName)).filter(Boolean) as string[]);
    const cand = shuffle(pool)[0];
    if (!cand || names.has(cand.pokemonName)) continue;
    const trial = best.slice();
    trial[slot] = cand;
    const err = recipeError(sumStats(trial), opts);
    if (err < bestErr - SCORE_EPS) {
      best = trial;
      bestErr = err;
      if (bestErr <= SCORE_EPS) break;
    }
  }
  return { loadout: best, error: bestErr };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface RecipeSearchResult {
  loadout: EmblemCandidate[];
  error: number;
}

/**
 * Attempt to find a 10-emblem loadout that meets the target stat values using
 * stat-signature recipe decomposition + DFS count assignment.
 * Returns null if no solution found or pool/recipes are insufficient.
 */
export function searchByRecipes(
  pool: EmblemCandidate[],
  opts: SearchOptions,
  slots: number,
  shouldAbort?: () => boolean,
): RecipeSearchResult | null {
  if (shouldAbort?.()) return null;

  const cat = buildSignatureCatalog(pool);
  const allRecipes: Recipe[] = [];
  for (const [sig, cands] of cat) {
    if (isRecipeRelevant(cands[0].stats, opts)) {
      allRecipes.push({
        sig,
        cands,
        stats: cands[0].stats,
        nameCount: new Set(cands.map((c) => c.pokemonName)).size,
      });
    }
  }
  if (!allRecipes.length) return null;

  const recipes = capRecipes(allRecipes, opts);
  const solved = solveRecipeCounts(recipes, opts, slots, shouldAbort);
  if (!solved) return null;

  let bestLoadout: EmblemCandidate[] | null = null;
  let bestErr = solved.error;

  for (let attempt = 0; attempt < 80; attempt++) {
    if (shouldAbort?.()) return null;
    const L = assignFromCounts(solved, slots, opts);
    if (!L) continue;
    const polished = polishLoadout(L, pool, opts);
    if (polished.error < bestErr - SCORE_EPS || (!bestLoadout && polished.error <= bestErr + SCORE_EPS)) {
      bestErr = polished.error;
      bestLoadout = polished.loadout;
    }
    if (bestErr <= SCORE_EPS) break;
  }

  if (!bestLoadout) return null;
  return { loadout: bestLoadout, error: bestErr };
}
