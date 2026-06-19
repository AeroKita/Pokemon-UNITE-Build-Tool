/**
 * Derive per-Pokémon default "protect" stat floors from base-stat population
 * statistics plus lightweight role-aware fallbacks.
 *
 * A protect floor tells the search engine: "penalise builds where the total
 * flat emblem contribution to this stat falls below the floor". Floor = 0
 * means "don't let emblems net-reduce this stat" — the right conservative
 * default, matching uniteemblemfinder's default-0 protect semantics.
 *
 * Hybrid derivation (population z-scores + role rules):
 *
 *   1. Primary: top stats with z > Z_THRESHOLD, up to MAX_PROTECT, floor = 0.
 *   2. Offense fallback (Attacker / Speedster / AllRounder): if the primary
 *      offense stat (from attackType, or attack vs spAttack for hybrid) has
 *      z > Z_OFFENSE_FALLBACK, ensure it is protected when slots remain.
 *   3. Glass HP exclusion (Attacker / Speedster): never add HP via role
 *      rules unless HP z > Z_THRESHOLD (same bar as the primary pass).
 *   4. Defender bulk boost: if hp or defense has z > Z_DEFENDER_BULK, ensure
 *      the higher-z bulk stat is protected when slots remain.
 *
 * Role rules only fill gaps after the primary z > Z_THRESHOLD pass and never
 * exceed MAX_PROTECT.
 *
 * This updates automatically when new UNITE-DB data is loaded: as Pokémon are
 * added, the population mean/std shifts and protect picks adjust accordingly.
 *
 * Design choices:
 *  - Candidate stats: hp, attack, spAttack, defense, spDefense. These are the
 *    stats Pokémon strongly differentiate on, where an emblem set that erodes
 *    one is harmful. CDR and attackSpeed are also useful in principle but are
 *    0 for most Pokémon at base level and would produce noisy results.
 *  - Normalization: divide by STAT_NORM (same scale as evaluate.ts) before
 *    computing population mean/std so all stats are comparable.
 *  - Floor = 0: "net emblem contribution must not be negative". Pink emblems
 *    yield negative HP — this guard prevents them from being chosen when HP is
 *    a protected stat. For stats with only positive emblem contributions the
 *    floor rarely triggers, which is the correct behavior.
 *  - Max protected stats: up to MAX_PROTECT (2) to keep defaults conservative.
 */

import type { Pokemon, Role, StatBlock } from "../../types";
import { priorityWeights } from "../recommend";
import type { StatFloors } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type ProtectStat = "hp" | "attack" | "spAttack" | "defense" | "spDefense";

/** Stats considered as candidates for default protection. */
const PROTECT_CANDIDATES: ReadonlyArray<ProtectStat> = [
  "hp",
  "attack",
  "spAttack",
  "defense",
  "spDefense",
];

/**
 * Per-stat normalization divisors (same as STAT_NORM in evaluate.ts).
 * Keeps stats on a comparable scale when computing z-scores.
 */
const NORM: Record<ProtectStat, number> = {
  hp: 200,
  attack: 14,
  spAttack: 14,
  defense: 14,
  spDefense: 14,
};

/** z-score threshold: protect stats that are this many std-devs above average. */
export const Z_THRESHOLD = 0.4;

/** Lower bar for role offense fallback on offensive roles. */
export const Z_OFFENSE_FALLBACK = 0.25;

/** Lower bar for Defender bulk-stat fallback (hp or defense). */
export const Z_DEFENDER_BULK = 0.3;

/** Maximum number of stats to protect by default. Keeps defaults conservative. */
export const MAX_PROTECT = 2;

/**
 * Lenient protect floor for defense / spDefense on glass or low-bulk roles.
 *
 * Meta builds commonly carry a small net-negative def/spDef tax (−3 to −8) from
 * offensive emblems; floor = 0 over-penalises that. A soft floor of −5 blocks
 * the −15 to −25 stacks the optimizer otherwise picks when def/spDef weight is 0
 * (Attacker / Speedster) or very low. Meta builds at −8 spDef incur a small
 * penalty vs unguarded search but remain feasible when cleaner emblems exist.
 */
export const DEFENSE_SOFT_FLOOR = -5;

/**
 * Apply {@link DEFENSE_SOFT_FLOOR} when role-based priority weight for a bulk
 * stat is at or below this threshold (AllRounder def/spDef = 1 included).
 */
export const DEFENSE_SOFT_FLOOR_WEIGHT_THRESHOLD = 1;

/** Roles that benefit from primary-offense protect fallback. */
const OFFENSIVE_ROLES: ReadonlySet<Role> = new Set([
  "Attacker",
  "Speedster",
  "AllRounder",
]);

/** Roles that should not receive HP via sub-threshold role rules. */
const GLASS_ROLES: ReadonlySet<Role> = new Set(["Attacker", "Speedster"]);

/**
 * Roles whose kit depends on mobility. For these, net-negative move speed from
 * emblems is a default-bad trade — we guard it with a floor of 0. Defenders
 * intentionally trade mobility for survivability, so they are excluded.
 */
const MOBILITY_ROLES: ReadonlySet<Role> = new Set([
  "Attacker",
  "Speedster",
  "AllRounder",
  "Supporter",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Primary offense stat from attackType (hybrid uses whichever base stat is higher). */
function primaryOffenseStat(pokemon: Pokemon, bs: StatBlock): "attack" | "spAttack" {
  if (pokemon.attackType === "special") return "spAttack";
  if (pokemon.attackType === "physical") return "attack";
  return (bs.attack ?? 0) >= (bs.spAttack ?? 0) ? "attack" : "spAttack";
}

/** Whether a stat may be added via a role rule (glass roles block sub-threshold HP). */
function canAddViaRoleRule(
  pokemon: Pokemon,
  stat: ProtectStat,
  zByStat: ReadonlyMap<ProtectStat, number>,
): boolean {
  if (stat === "hp" && GLASS_ROLES.has(pokemon.role)) {
    return (zByStat.get("hp") ?? 0) > Z_THRESHOLD;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Core derivation
// ---------------------------------------------------------------------------

/**
 * Derive which stats are worth protecting for a given Pokémon, based on how
 * its base stats compare to the full population distribution plus role rules.
 *
 * Returns a `StatFloors` object mapping each "defining" stat → floor of 0.
 * Returns `{}` if the Pokémon has no base stat data or the population is empty.
 *
 * @param pokemon     The Pokémon to derive protect floors for.
 * @param allPokemon  Full Pokémon dataset (used for population statistics).
 * @param level       Level to evaluate at (1–15). Defaults to 15 (max).
 */
export function deriveDefaultProtectedStats(
  pokemon: Pokemon,
  allPokemon: Pokemon[],
  level = 15,
): StatFloors {
  if (allPokemon.length < 2) return {};

  const idx = Math.max(0, Math.min(level - 1, pokemon.baseStatsByLevel.length - 1));
  const bs = pokemon.baseStatsByLevel[idx];
  if (!bs) return {};

  // Compute population mean and std for each candidate stat (normalized).
  const popValues: Record<string, number[]> = Object.fromEntries(
    PROTECT_CANDIDATES.map((s) => [s, []]),
  );
  for (const p of allPokemon) {
    const pIdx = Math.max(0, Math.min(idx, p.baseStatsByLevel.length - 1));
    const pBs = p.baseStatsByLevel[pIdx];
    if (!pBs) continue;
    for (const stat of PROTECT_CANDIDATES) {
      popValues[stat].push((pBs[stat] ?? 0) / NORM[stat]);
    }
  }

  // Compute z-score for each stat and sort descending.
  const zScores = PROTECT_CANDIDATES.map((stat) => {
    const vals = popValues[stat];
    if (vals.length === 0) return { stat, z: 0 };
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    // Guard: treat near-zero variance as all-same population (floating-point noise
    // in the sum of identical-but-non-exact values can produce tiny non-zero variance).
    const std = variance < 1e-10 ? 1 : Math.sqrt(variance);
    const thisNorm = (bs[stat] ?? 0) / NORM[stat];
    return { stat, z: (thisNorm - mean) / std };
  }).sort((a, b) => b.z - a.z);

  const zByStat = new Map<ProtectStat, number>(
    zScores.map(({ stat, z }) => [stat, z]),
  );
  const protectedStats = new Set<ProtectStat>();

  // Phase 1: primary z-score picks (z > Z_THRESHOLD), highest first.
  for (const { stat, z } of zScores) {
    if (protectedStats.size >= MAX_PROTECT) break;
    if (z <= Z_THRESHOLD) break;
    protectedStats.add(stat);
  }

  // Phase 2: role rules fill remaining slots (priority after primary picks).
  if (protectedStats.size < MAX_PROTECT && OFFENSIVE_ROLES.has(pokemon.role)) {
    const offenseStat = primaryOffenseStat(pokemon, bs);
    const offenseZ = zByStat.get(offenseStat) ?? 0;
    if (
      offenseZ > Z_OFFENSE_FALLBACK &&
      !protectedStats.has(offenseStat) &&
      canAddViaRoleRule(pokemon, offenseStat, zByStat)
    ) {
      protectedStats.add(offenseStat);
    }
  }

  if (protectedStats.size < MAX_PROTECT && pokemon.role === "Defender") {
    const hpZ = zByStat.get("hp") ?? 0;
    const defZ = zByStat.get("defense") ?? 0;
    if (hpZ > Z_DEFENDER_BULK || defZ > Z_DEFENDER_BULK) {
      const bulkStat: ProtectStat = hpZ >= defZ ? "hp" : "defense";
      if (
        !protectedStats.has(bulkStat) &&
        canAddViaRoleRule(pokemon, bulkStat, zByStat)
      ) {
        protectedStats.add(bulkStat);
      }
    }
  }

  const floors: StatFloors = {};
  for (const stat of protectedStats) {
    floors[stat] = 0;
  }
  return floors;
}

/**
 * Derive a move-speed protect floor for mobility-dependent roles.
 *
 * Returns `{ moveSpeed: 0 }` for Attacker / Speedster / AllRounder ("don't let
 * emblems net-reduce move speed"), otherwise `{}`.
 *
 * Rationale: most physical/mobile roles weight `moveSpeed` at 0 in
 * {@link priorityWeights}, so the search engine sees no cost for the −35 move
 * speed tax carried by many +HP/+attack emblems (Rhyhorn, Pupitar, Machop, …).
 * Left unguarded the optimizer happily stacks them, producing tanky-but-sluggish
 * builds that diverge from curated community builds (which keep move speed ≥
 * base). A floor of 0 is a soft, graduated penalty: tiny net negatives barely
 * register, while large mobility losses are strongly discouraged when cleaner
 * emblems exist. It never *seeks* move speed (no weight added), so it won't
 * over-correct toward move-speed emblems.
 *
 * Kept separate from {@link deriveDefaultProtectedStats} because it is a
 * role-based kit guard, not a population-relative "defining stat" pick, and so
 * is intentionally not subject to the MAX_PROTECT cap.
 */
export function deriveMobilityFloor(pokemon: Pokemon): StatFloors {
  return MOBILITY_ROLES.has(pokemon.role) ? { moveSpeed: 0 } : {};
}

/**
 * Derive lenient defense / spDefense protect floors for roles that do not
 * weight bulk stats in {@link priorityWeights}.
 *
 * Returns `{ defense: DEFENSE_SOFT_FLOOR, spDefense: DEFENSE_SOFT_FLOOR }`
 * (or a subset) when each stat's priority weight is at or below
 * {@link DEFENSE_SOFT_FLOOR_WEIGHT_THRESHOLD}. Defender / Supporter bulk
 * weighting is high enough that no soft floor is applied.
 *
 * Kept separate from {@link deriveDefaultProtectedStats} because it is a
 * role-based kit guard (like mobility), not a population z-score pick, and is
 * not subject to the MAX_PROTECT cap. Z-score picks at floor = 0 still win
 * when merged in {@link deriveProtectFloors}.
 */
export function deriveDefenseSoftFloor(pokemon: Pokemon): StatFloors {
  const weights = priorityWeights(pokemon);
  const floors: StatFloors = {};
  for (const stat of ["defense", "spDefense"] as const) {
    if ((weights[stat] ?? 0) <= DEFENSE_SOFT_FLOOR_WEIGHT_THRESHOLD) {
      floors[stat] = DEFENSE_SOFT_FLOOR;
    }
  }
  return floors;
}

/**
 * Combined protect floors for search and Advanced UI defaults: population
 * z-score defining-stat picks plus role-based mobility and defense guards.
 *
 * Requires a roster of at least 2 Pokémon for role guards (mobility +
 * defense soft floor); with an empty roster returns only z-score floors
 * (typically `{}`) for backward compatibility.
 */
export function deriveProtectFloors(
  pokemon: Pokemon,
  allPokemon: Pokemon[],
  level = 15,
): StatFloors {
  const baseFloors = deriveDefaultProtectedStats(pokemon, allPokemon, level);
  if (allPokemon.length < 2) return baseFloors;

  // Z-score picks (floor 0) override softer defense floors when both apply.
  return {
    ...deriveDefenseSoftFloor(pokemon),
    ...deriveMobilityFloor(pokemon),
    ...baseFloors,
  };
}
