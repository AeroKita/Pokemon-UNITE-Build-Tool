/**
 * Shared "preset" search-option builder.
 *
 * Both the Beginner one-click flow and the Expert "Reset to auto defaults"
 * action want to translate a Pokémon's meta color targets into a real search
 * configuration. Historically the feasibility logic that decides whether those
 * targets can be enforced as *hard* color constraints (exact enumeration) vs.
 * merely steered toward via the soft color-bonus incentive (weighted/heuristic)
 * lived inline in `EmblemOptimizer.syncAdvancedFromBasic`. Beginner never used
 * it, so Beginner always ran the heuristic search.
 *
 * This module is the single source of truth for that decision so Beginner and
 * Expert behave identically: a Beginner search now runs the Expert-equivalent
 * search (exact whenever feasible on the actual Beginner pool, heuristic
 * otherwise) with the controls hidden.
 */

import type { Emblem, EmblemColor, Pokemon } from "../../types";
import { colorGroupSizes } from "./exactColor";
import { countConstrainedBuilds } from "./pool";
import { DEFAULT_EXACT_CAP, shouldRunExact } from "./orchestrator";
import { deriveBasicObjective, type BasicObjective } from "./basicObjective";
import type { EmblemCandidate, SearchOptions } from "./types";

/** UNITE emblem loadouts are always 10 slots. */
const SLOTS = 10;

/** Color control mode the resolver chose for a given pool + targets. */
export type ColorSearchMode = "exact" | "weighted";

export interface ColorSearchResolution {
  /**
   * "exact" → enforce the meta color targets as hard per-color constraints
   * (the orchestrator runs exact enumeration when within the cap).
   * "weighted" → no hard constraints; the soft color-bonus incentive steers
   * the heuristic search instead.
   */
  mode: ColorSearchMode;
  /** Hard color constraints when mode==="exact"; null when mode==="weighted". */
  colorConstraints: Map<EmblemColor, number> | null;
  /**
   * Result of countConstrainedBuilds on the pool for these targets:
   *  • bigint > 0n → that many color-feasible builds exist.
   *  • 0n → infeasible on this pool.
   *  • null → DP overflow (too many to count) OR targets not enforceable.
   */
  constrainedBuildCount: bigint | null;
  /**
   * Whether the orchestrator will actually run exact enumeration for this
   * resolution under DEFAULT_EXACT_CAP. False when weighted, when the count
   * overflowed (null), or when the count exceeds the cap → heuristic fallback.
   */
  willRunExact: boolean;
}

/**
 * Decide whether a Pokémon's meta color targets can be enforced as hard
 * constraints on the given pool (exact search) or should fall back to the
 * soft color-bonus incentive (weighted/heuristic).
 *
 * Mirrors the feasibility logic previously inlined in
 * `syncAdvancedFromBasic`:
 *  1. per-color capacity: each target count ≤ distinct Pokémon carrying that color,
 *  2. sum of target counts ≤ 2×slots (dual-color emblems count toward both),
 *  3. countConstrainedBuilds(...) is feasible (≠ 0n).
 *
 * @param pool    The ACTUAL pool the search will run on (owned or full).
 * @param targets Meta color targets (color → required count).
 * @param slots   Loadout size (default 10).
 */
export function resolveColorSearchMode(
  pool: EmblemCandidate[],
  targets: Map<EmblemColor, number>,
  slots: number = SLOTS,
): ColorSearchResolution {
  const weighted = (constrainedBuildCount: bigint | null): ColorSearchResolution => ({
    mode: "weighted",
    colorConstraints: null,
    constrainedBuildCount,
    willRunExact: false,
  });

  if (targets.size === 0) return weighted(null);

  const caps = colorGroupSizes(pool);
  const sum = [...targets.values()].reduce((a, b) => a + b, 0);
  const capacityOk = [...targets.entries()].every(([c, n]) => n <= (caps.get(c) ?? 0));

  // Capacity / sum infeasible → can't enforce as hard constraints. Don't even
  // run the DP (countConstrainedBuilds would return 0n anyway for sum>2*slots).
  if (sum > 2 * slots || !capacityOk) return weighted(null);

  const constrainedBuildCount = countConstrainedBuilds(pool, targets, slots);

  // 0n → no build can satisfy the exact counts → soft steering only.
  if (constrainedBuildCount === 0n) return weighted(0n);

  // Feasible (count > 0n) OR DP overflow (null). Both set the constraints as
  // hard targets — exactly as Expert did. The orchestrator then decides exact
  // vs heuristic via shouldRunExact: a null count (overflow) or a count above
  // the cap falls back to the heuristic automatically.
  return {
    mode: "exact",
    colorConstraints: new Map(targets),
    constrainedBuildCount,
    willRunExact: shouldRunExact(constrainedBuildCount, DEFAULT_EXACT_CAP),
  };
}

export interface BuildPresetParams {
  pokemon: Pokemon;
  level: number;
  /** The ACTUAL pool the search will run on — feasibility is judged on this. */
  pool: EmblemCandidate[];
  /** Full emblem list (needed to resolve curated-build color counts). */
  emblems: Emblem[];
  /** Full roster for population-relative protect-floor derivation. */
  pokemonList?: Pokemon[];
  /**
   * When true, deliberately strip the hard color constraints so the
   * orchestrator skips Phase-2 exact enumeration and runs the heuristic at the
   * chosen effort instead — even when the meta targets are feasible (i.e. exact
   * is possible). The soft color-bonus incentive (colorBonuses) still steers the
   * heuristic toward the meta colors. Defaults to false (exact whenever feasible).
   */
  forceHeuristic?: boolean;
}

export interface PresetSearchBuild {
  options: SearchOptions;
  resolution: ColorSearchResolution;
  objective: BasicObjective;
}

/**
 * Build the SearchOptions for a one-click / preset search.
 *
 * Produces the Expert-equivalent configuration: stat priorities, protect
 * floors and Pokémon-aware scoring from {@link deriveBasicObjective}, plus the
 * meta color targets enforced as hard constraints whenever they are feasible
 * on `pool` (otherwise soft color-bonus steering). exactCap is the default 1B,
 * so exact enumeration runs whenever the constrained build count is countable
 * and within budget — identical to an Expert search with auto defaults.
 */
export function buildPresetSearchOptions(params: BuildPresetParams): PresetSearchBuild {
  const { pokemon, level, pool, emblems, pokemonList = [], forceHeuristic = false } = params;
  const objective = deriveBasicObjective(pokemon, level, emblems, pokemonList);
  const targets = objective.colorTargets as Map<EmblemColor, number>;
  const resolution = resolveColorSearchMode(pool, targets, SLOTS);

  // forceHeuristic drops the hard constraints so the orchestrator goes to the
  // heuristic path even when exact is feasible; colorBonuses still steers softly.
  const colorConstraints = forceHeuristic ? null : resolution.colorConstraints;

  const options: SearchOptions = {
    mode: "maximize",
    priorities: objective.priorities,
    targets: {},
    targetActive: {},
    protected: objective.protectedFloors,
    colorConstraints,
    colorBonuses: true,
    scoringMode: "pokemon",
    pokemonContext: objective.pokemonContext,
    slots: SLOTS,
    exactCap: DEFAULT_EXACT_CAP,
  };

  return { options, resolution, objective };
}
