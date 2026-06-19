/**
 * Pokémon-aware scoring: wrap computeEffectiveStats to evaluate an emblem
 * loadout in terms of the selected Pokémon's real stats at a given level.
 *
 * Used for the final result display and to provide a Pokémon-context objective.
 */

import type { EmblemSetBonus, HeldItem, Pokemon, StatBlock } from "../../types";
import type { EmblemCandidate } from "./types";
import { computeEffectiveStats, setBonusStat } from "../formulas";
import { computeEmblemLoadout } from "../emblems";
import type { EmblemSlot } from "../../types";

/** Convert EmblemCandidates to EmblemSlots for computeEmblemLoadout. */
export function candidatesToSlots(candidates: EmblemCandidate[]): EmblemSlot[] {
  return candidates.map((c) => ({
    emblem: {
      id: c.id,
      pokemonName: c.pokemonName,
      colors: c.colors,
      iconAsset: "",
      statsByGrade: {
        bronze: c.grade === "bronze" ? c.stats : {},
        silver: c.grade === "silver" ? c.stats : c.grade === "bronze" ? {} : c.stats,
        gold: c.grade === "gold" || c.grade === "platinum" ? c.stats : {},
      },
    },
    grade: c.grade,
  }));
}

export interface PokemonScore {
  effectiveStats: StatBlock;
  /** Weighted score based on stats for this Pokémon's role/attack type. */
  score: number;
}

/**
 * Compute the true effective stats for a loadout on a specific Pokémon.
 * This is the "Phase D" Pokémon-aware scoring call.
 */
export function computePokemonScore(
  candidates: EmblemCandidate[],
  pokemon: Pokemon,
  level: number,
  items: HeldItem[],
  itemGrades: number[],
  setBonuses: EmblemSetBonus[],
  weights: Partial<Record<keyof StatBlock, number>>,
): PokemonScore {
  // Build proper EmblemLoadout from candidates using real emblem data
  // We need to reconstruct approximate slot data from flat candidate stats.
  const slots = candidatesToEmblemSlots(candidates, setBonuses);
  const emblemLoadout = computeEmblemLoadout(slots, setBonuses);
  const effectiveStats = computeEffectiveStats(
    pokemon,
    level,
    emblemLoadout,
    items,
    itemGrades,
    { inCombat: true, goalsScored: 0 },
  );

  // Weighted score over effective stats
  let score = 0;
  for (const [stat, w] of Object.entries(weights) as [keyof StatBlock, number][]) {
    score += (effectiveStats[stat] ?? 0) * w;
  }

  return { effectiveStats, score };
}

/**
 * Convert EmblemCandidates → EmblemSlot[] using gameData emblems lookup.
 * When the real emblem object isn't available we synthesise a minimal one.
 */
export function candidatesToEmblemSlots(
  candidates: EmblemCandidate[],
  _setBonuses: EmblemSetBonus[],
): EmblemSlot[] {
  return candidates.map((c) => ({
    emblem: {
      id: c.id,
      pokemonName: c.pokemonName,
      colors: [...c.colors],
      iconAsset: "",
      goldOnly: false,
      statsByGrade: {
        bronze: { ...c.stats },
        silver: { ...c.stats },
        gold: { ...c.stats },
      },
    },
    grade: c.grade,
  }));
}

/** The set-bonus color that matters most for this Pokémon. */
export function primaryColorForPokemon(pokemon: Pokemon): string {
  if (pokemon.attackType === "physical") return "brown";
  if (pokemon.attackType === "special") return "green";
  return "brown";
}

/**
 * Stat weights for Pokémon-aware scoring. Mirrors priorityWeights from
 * recommend.ts so the optimizer uses the same priority logic.
 */
export { priorityWeights as pokemonStatWeights } from "../recommend";

/**
 * Quick description of what stat bonuses a loadout provides at the chosen level.
 */
export function describeLoadoutGains(
  baseline: StatBlock,
  withEmblems: StatBlock,
): Partial<Record<keyof StatBlock, number>> {
  const gains: Partial<Record<keyof StatBlock, number>> = {};
  for (const key of Object.keys(baseline) as (keyof StatBlock)[]) {
    const delta = (withEmblems[key] ?? 0) - (baseline[key] ?? 0);
    if (Math.abs(delta) > 0.001) gains[key] = delta;
  }
  return gains;
}

/** Compute the baseline stats for a Pokémon with NO emblems (for delta display). */
export function baselineStats(
  pokemon: Pokemon,
  level: number,
  items: HeldItem[],
  itemGrades: number[],
  setBonuses: EmblemSetBonus[],
): StatBlock {
  const emptyLoadout = computeEmblemLoadout([], setBonuses);
  return computeEffectiveStats(
    pokemon,
    level,
    emptyLoadout,
    items,
    itemGrades,
    { inCombat: true, goalsScored: 0 },
  );
}

export { setBonusStat };
