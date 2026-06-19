/**
 * Basic optimizer mode — auto-derive search objectives from a Pokémon's role
 * and attack type, using the recommendation meta-knowledge in recommend.ts.
 *
 * This is the "one-click" path: the user picks a Pokémon and hits Search; the
 * engine derives everything else. Users who want custom settings switch to
 * Advanced mode, which is pre-filled from these auto-derived values.
 */

import type { Emblem, EmblemColor, EmblemGrade, EmblemOptimizerPreset, HeldItem, Pokemon } from "../../types";
import { colorTargetsFor, priorityWeights, scoreHeldItem, coreItemsFor } from "../recommend";
import { buildPool } from "./pool";
import type { EmblemCandidate, PokemonScoringContext, PoolConfig, SearchOptions, StatFloors, StatWeights } from "./types";
import { deriveProtectFloors } from "./protectDefaults";
import { presetColorTargets, presetPriorities, presetProtectFloors } from "./optimizerPresets";

/** Default grade filter: bronze, silver, and gold all enabled. */
export const DEFAULT_ALLOWED_GRADES: ReadonlySet<EmblemGrade> = new Set<EmblemGrade>([
  "bronze",
  "silver",
  "gold",
]);

/** Default pool settings when Basic mode loads (owned inventory, all grades). */
export const BASIC_POOL_DEFAULTS: Readonly<PoolConfig> = {
  useOwned: true,
  mixedGrades: true,
  allowedGrades: new Set(DEFAULT_ALLOWED_GRADES),
};

/**
 * Build the emblem search pool for Basic mode.
 * Same semantics as Advanced {@link buildPool}: owned inventory uses all owned
 * grades (subject to mixedGrades); allowedGrades applies only when useOwned=false.
 */
export function buildBasicPool(
  emblems: Emblem[],
  ownedKeys: Set<string>,
  config: Pick<PoolConfig, "useOwned" | "mixedGrades" | "allowedGrades">,
): EmblemCandidate[] {
  return buildPool(emblems, config, ownedKeys);
}

// ---------------------------------------------------------------------------
// Objective
// ---------------------------------------------------------------------------

export interface BasicObjective {
  /** Stat weights derived from priorityWeights(). Used in maximize mode. */
  priorities: StatWeights;
  /**
   * Recommended color targets from the meta (archetype defaults or curated build).
   * Informational — not enforced as hard constraints; the engine's colorBonuses
   * incentive naturally steers toward these colors.
   */
  colorTargets: Map<string, number>;
  /** Pokémon/level context for inner-loop scoring. */
  pokemonContext: PokemonScoringContext;
  /**
   * Default protect floors. Combines the Pokémon's population-relative defining
   * stats (see {@link deriveDefaultProtectedStats}) with a role-based move-speed
   * guard for mobile kits (see {@link deriveMobilityFloor}). Each entry maps a
   * stat → floor of 0 ("don't let emblems net-reduce this stat"). Applied as a
   * soft penalty in the search engine.
   */
  protectedFloors: StatFloors;
}

/**
 * Derive the Basic-mode search objective for a given Pokémon at a given level.
 *
 * When a `preset` is supplied (the per-Pokémon community/curated preset resolved
 * by {@link resolveEmblemPreset}), its priorities, color shell and protect
 * floors are used instead of the role-generic derivation — the latter remains
 * the fallback when no preset is passed (preset null/omitted). Preset floors are
 * merged with the role-based mobility and defense soft-floor guards so those are
 * never weakened (see {@link presetProtectFloors}).
 *
 * @param pokemon     The selected Pokémon.
 * @param level       The level to optimize for (1–15).
 * @param emblems     Full emblem list (needed to resolve curated build color counts).
 * @param allPokemon  Full Pokémon roster, used for population-relative protect
 *                    floor derivation. Pass [] (default) to skip protect defaults.
 * @param preset      Resolved per-Pokémon preset, or null/omitted for generic.
 */
export function deriveBasicObjective(
  pokemon: Pokemon,
  level: number,
  emblems: Emblem[],
  allPokemon: Pokemon[] = [],
  preset: EmblemOptimizerPreset | null = null,
): BasicObjective {
  const baseStats = pokemon.baseStatsByLevel[Math.max(0, level - 1)] ?? pokemon.baseStatsByLevel[0];
  const pokemonContext: PokemonScoringContext = {
    pokemonId: pokemon.id,
    level,
    baseStats,
  };

  if (preset) {
    return {
      priorities: presetPriorities(preset),
      colorTargets: presetColorTargets(preset),
      pokemonContext,
      protectedFloors: presetProtectFloors(pokemon, preset),
    };
  }

  const priorities = priorityWeights(pokemon);
  const byId = new Map(emblems.map((e) => [e.id, e]));
  const colorTargets = colorTargetsFor(pokemon, byId);
  const protectedFloors = deriveProtectFloors(pokemon, allPokemon, level);
  return { priorities, colorTargets, pokemonContext, protectedFloors };
}

/**
 * Build the SearchOptions for Basic mode from a derived objective.
 *
 * Uses: maximize mode, Pokémon-aware scoring, color-bonus incentive.
 *
 * `colorConstraints` controls whether the meta color targets are enforced as
 * hard per-color constraints (triggering the orchestrator's exact enumeration
 * when feasible) or left null (soft steering via the colorBonuses incentive
 * → heuristic). Callers should pass the resolution from
 * {@link resolveColorSearchMode} run on the ACTUAL pool so Beginner runs the
 * Expert-equivalent search. Defaults to null for backward compatibility.
 *
 * Pair with {@link buildBasicPool}; pool source (owned vs full dataset) is a UI concern.
 */
export function basicSearchOptions(
  objective: BasicObjective,
  colorConstraints: Map<EmblemColor, number> | null = null,
): SearchOptions {
  return {
    mode: "maximize",
    priorities: objective.priorities,
    targets: {},
    targetActive: {},
    // Use derived protect floors so Basic mode automatically guards the
    // Pokémon's defining stats from being net-reduced by emblem choices.
    protected: objective.protectedFloors,
    // Hard color constraints when the meta targets are feasible on the pool;
    // null lets the colorBonuses incentive steer naturally instead.
    colorConstraints,
    colorBonuses: true,
    scoringMode: "pokemon",
    pokemonContext: objective.pokemonContext,
    slots: 10,
  };
}

// ---------------------------------------------------------------------------
// Human-readable description
// ---------------------------------------------------------------------------

const STAT_LABEL: Partial<Record<string, string>> = {
  attack: "Attack", spAttack: "Sp. Atk", hp: "HP", defense: "Def",
  spDefense: "Sp. Def", critRate: "Crit", cdr: "CDR",
  attackSpeed: "Atk Spd", moveSpeed: "Spd", lifesteal: "Lifesteal",
};

/**
 * Return the top stat priorities (sorted by weight, labelled) for display in Basic mode's info chip row.
 */
export function topPriorityLabels(priorities: StatWeights, maxCount = 4): string[] {
  return (Object.entries(priorities) as [string, number][])
    .filter(([, w]) => w > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, maxCount)
    .map(([s]) => STAT_LABEL[s] ?? s);
}

/**
 * Return a one-line role description for the Basic mode auto-objective card.
 */
export function basicObjectiveDescription(pokemon: Pokemon): string {
  const type = pokemon.attackType === "hybrid" ? "physical/special" : pokemon.attackType;
  return `${pokemon.role} · ${type}`;
}

/**
 * Score held items for Basic mode using the auto-derived weights.
 * Returns sorted (best first) item IDs from the owned pool.
 */
export function rankOwnedHeldItems(
  pokemon: Pokemon,
  ownedItems: HeldItem[],
  grade = 30,
): { itemId: string; score: number }[] {
  const weights = priorityWeights(pokemon);
  const coreIds = coreItemsFor(pokemon);
  const eligible = ownedItems.filter((i) => Object.keys(i.statsByGrade).length > 0);
  return eligible
    .map((i) => ({ itemId: i.id, score: scoreHeldItem(i, weights, coreIds, grade) }))
    .sort((a, b) => b.score - a.score);
}
