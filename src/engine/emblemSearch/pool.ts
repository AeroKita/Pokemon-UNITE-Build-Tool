/**
 * Pool-building: from the full emblem dataset → a filtered EmblemCandidate[].
 */

import type { Emblem, EmblemColor } from "../../types";
import type { EmblemCandidate, PoolConfig } from "./types";
import { buildCandidatePool, distinctPokemonCount } from "./adapt";

export { distinctPokemonCount };

/**
 * Build the search pool according to the configuration.
 * - useOwned=true: only owned emblems; mixedGrades controls whether all owned
 *   grade variants are included (true) or only the best-owned grade (false).
 *   allowedGrades is ignored for owned pools.
 * - useOwned=false: all emblems at the specified allowedGrades; mixedGrades=false
 *   includes only the highest allowed grade per Pokémon (gold first).
 */
export function buildPool(
  emblems: Emblem[],
  config: PoolConfig,
  ownedKeys: Set<string>,
): EmblemCandidate[] {
  if (config.useOwned) {
    return buildCandidatePool(emblems, {
      ownedKeys,
      mixedGrades: config.mixedGrades ?? true,
    });
  }
  return buildCandidatePool(emblems, {
    grades: [...config.allowedGrades],
    mixedGrades: config.mixedGrades ?? true,
  });
}

/**
 * Count valid k-slot loadouts: pick k distinct Pokémon, one grade variant each.
 *
 * For Pokémon i with v_i grade variants in the pool, the count is
 *   e_k(v_1, …, v_n) = Σ_{|S|=k} Π_{i∈S} v_i
 * computed in O(n·k) via DP (no enumeration of individual loadouts).
 */
function countDistinctLoadouts(variantCounts: number[], slots: number): bigint {
  if (variantCounts.length < slots) return 0n;
  if (variantCounts.every((v) => v === 1)) return binomialBig(variantCounts.length, slots);

  const ways = Array.from({ length: slots + 1 }, () => 0n);
  ways[0] = 1n;
  for (const v of variantCounts) {
    const w = BigInt(v);
    for (let k = slots; k >= 1; k--) {
      ways[k] += ways[k - 1] * w;
    }
  }
  return ways[slots];
}

/** Distinct Pokémon names → number of grade variants present in the pool. */
function variantCountsByPokemon(pool: EmblemCandidate[]): number[] {
  const counts = new Map<string, number>();
  for (const c of pool) {
    counts.set(c.pokemonName, (counts.get(c.pokemonName) ?? 0) + 1);
  }
  return [...counts.values()];
}

/**
 * Number of valid 10-slot loadouts (distinct Pokémon, order-independent) from
 * this pool. Each slot picks one grade variant for a distinct Pokémon name.
 *
 * Single-grade pools: C(distinctPokemon, 10). Multi-grade pools: full
 * combinatorial count including grade choice per slot.
 */
export function approximateBuildCount(pool: EmblemCandidate[], slots = 10): bigint {
  return countDistinctLoadouts(variantCountsByPokemon(pool), slots);
}

function binomialBig(n: number, k: number): bigint {
  if (k > n) return 0n;
  if (k === 0 || k === n) return 1n;
  k = Math.min(k, n - k);
  let num = 1n;
  for (let i = 0; i < k; i++) {
    num = (num * BigInt(n - i)) / BigInt(i + 1);
  }
  return num;
}

/**
 * Format a BigInt build count for human-readable display.
 * Tiers: T ≥ 1e12, B ≥ 1e9, M ≥ 1e6, k ≥ 1e3, else exact.
 * Used for both constrained-build counts AND the exactCap value, so both
 * always appear at the same scale — ensuring "count > cap" comparisons
 * in indicator strings are always internally consistent.
 */
export function formatBuildCount(n: bigint): string {
  const m = Number(n);
  if (m >= 1e12) return (m / 1e12).toFixed(1) + "T";
  if (m >= 1e9) return (m / 1e9).toFixed(1) + "B";
  if (m >= 1e6) return (m / 1e6).toFixed(1) + "M";
  if (m >= 1e4) return Math.round(m / 1000) + "k";
  if (m >= 1000) return (m / 1000).toFixed(1) + "k";
  return String(m);
}

// ---------------------------------------------------------------------------
// Constrained build count (dual-color-aware DP)
// ---------------------------------------------------------------------------

type ColorGroup = { vec: number[]; variantCounts: number[] };

/** Ways to pick x Pokémon from a group (x = 0..count). */
function groupPickWays(variantCounts: number[], gradeAware: boolean): bigint[] {
  const count = variantCounts.length;
  const pickWays = Array.from({ length: count + 1 }, () => 0n);
  if (gradeAware) {
    pickWays[0] = 1n;
    for (const v of variantCounts) {
      const w = BigInt(v);
      for (let x = count; x >= 1; x--) {
        pickWays[x] += pickWays[x - 1] * w;
      }
    }
  } else {
    for (let x = 0; x <= count; x++) pickWays[x] = binomialBig(count, x);
  }
  return pickWays;
}

function buildColorGroups(pool: EmblemCandidate[], checked: EmblemColor[]): ColorGroup[] {
  const byName = new Map<string, { colors: EmblemColor[]; variants: number }>();
  for (const c of pool) {
    const entry = byName.get(c.pokemonName);
    if (!entry) {
      byName.set(c.pokemonName, { colors: c.colors, variants: 1 });
    } else {
      entry.variants++;
    }
  }

  const groupMap = new Map<string, ColorGroup>();
  for (const { colors, variants } of byName.values()) {
    const vec = checked.map((col) => (colors.includes(col) ? 1 : 0));
    const key = vec.join(",");
    const g = groupMap.get(key) ?? { vec, variantCounts: [] };
    g.variantCounts.push(variants);
    groupMap.set(key, g);
  }
  return [...groupMap.values()];
}

function countConstrainedBuildsInternal(
  pool: EmblemCandidate[],
  colorConstraints: Map<EmblemColor, number>,
  slots: number,
  gradeAware: boolean,
): bigint | null {
  const checked = [...colorConstraints.keys()];
  if (!checked.length) return null;

  const targetVec = checked.map((col) => colorConstraints.get(col)!);
  const sum = targetVec.reduce((a, b) => a + b, 0);
  if (sum > 2 * slots) return 0n;
  if (targetVec.some((t) => t > slots)) return 0n;

  const groups = buildColorGroups(pool, checked);

  const initKey = "0|" + targetVec.map(() => 0).join(",");
  let dp = new Map<string, bigint>([[initKey, 1n]]);
  const MAX_DP_STATES = 300_000;

  for (const { vec, variantCounts } of groups) {
    const count = variantCounts.length;
    const pickWays = groupPickWays(variantCounts, gradeAware);

    const ndp = new Map<string, bigint>();
    for (const [key, ways] of dp) {
      const bar = key.indexOf("|");
      const usedSlots = +key.slice(0, bar);
      const colorCounts = key
        .slice(bar + 1)
        .split(",")
        .map(Number);

      for (let x = 0; x <= count; x++) {
        const ns = usedSlots + x;
        if (ns > slots) break;

        let ok = true;
        const nc = colorCounts.slice();
        for (let j = 0; j < nc.length; j++) {
          nc[j] += x * vec[j];
          if (nc[j] > targetVec[j]) {
            ok = false;
            break;
          }
        }
        if (!ok) break;

        const nk = ns + "|" + nc.join(",");
        ndp.set(nk, (ndp.get(nk) ?? 0n) + ways * pickWays[x]);
      }
    }
    if (ndp.size > MAX_DP_STATES) return null;
    dp = ndp;
  }

  return dp.get(slots + "|" + targetVec.join(",")) ?? 0n;
}

/**
 * Count distinct 10-Pokémon loadouts (including grade choice per slot) whose
 * per-color counts satisfy colorConstraints. Used for UI "search space" display.
 *
 * Returns 0n when infeasible, null when the DP state space exceeds MAX_DP_STATES.
 */
export function countConstrainedBuilds(
  pool: EmblemCandidate[],
  colorConstraints: Map<EmblemColor, number>,
  slots = 10,
): bigint | null {
  return countConstrainedBuildsInternal(pool, colorConstraints, slots, true);
}

/**
 * Count exact enumeration space for color-constrained search.
 *
 * When gradeAware is false (default): Pokémon-name combos only — k-vector ×
 * C(n_g,k) per group, one grade via bestVariantForMode.
 *
 * When gradeAware is true: every grade assignment per name combo (matches
 * enumerateGradeVariants in exactColor).
 *
 * Use for exact gating (shouldRunExact) and progress-bar alignment.
 */
export function countExactEnumerationSpace(
  pool: EmblemCandidate[],
  colorConstraints: Map<EmblemColor, number>,
  slots = 10,
  gradeAware = false,
): bigint | null {
  return countConstrainedBuildsInternal(pool, colorConstraints, slots, gradeAware);
}

/**
 * Numerator for "Matching builds" in exact color mode — aligned with what
 * exactColor enumerates (matches progress bar). Falls back to the other count
 * when the primary could not be computed.
 */
export function matchingBuildDisplayCount(
  exactEnumerationCount: bigint | null,
  constrainedBuildCount: bigint | null,
  enumerateGradeVariants = false,
): bigint | null {
  if (enumerateGradeVariants) {
    return exactEnumerationCount ?? constrainedBuildCount;
  }
  return exactEnumerationCount ?? constrainedBuildCount;
}
