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
import { colorTargetsFor } from "../recommend";
import { colorGroupSizes } from "./exactColor";
import { countConstrainedBuilds, countExactEnumerationSpace } from "./pool";
import { DEFAULT_EXACT_CAP, shouldRunExact } from "./orchestrator";
import { deriveBasicObjective, type BasicObjective } from "./basicObjective";
import { presetColorTargets, resolveEmblemPreset } from "./optimizerPresets";
import type { EmblemCandidate, SearchOptions } from "./types";

/** UNITE emblem loadouts are always 10 slots. */
const SLOTS = 10;

/**
 * Beginner search effort/quality picker value.
 *
 *  • "quick" / "normal" / "thorough" → heuristic search at increasing effort.
 *  • "exact" → exhaustive exact enumeration. Only offered when enumeration is
 *    feasible on the current pool (see {@link resolveColorSearchMode}).
 *
 * Effort is ONLY about search strategy/quality. It is orthogonal to color
 * matching: hard color constraints are applied automatically whenever they are
 * feasible (Concept A), on ANY effort — see {@link resolveBasicSearchParams}.
 * Defaults to "normal" (Balanced) in the UI.
 */
export type BasicEffort = "exact" | "quick" | "normal" | "thorough";

/** Heuristic effort substituted when "exact" is selected but enumeration is infeasible. */
export const EXACT_FALLBACK_EFFORT = "normal" as const;

/** The heuristic effort tiers (the orchestrator never receives "exact"). */
export type HeuristicEffort = "quick" | "normal" | "thorough";

/** Basic-tab search wiring derived from pool feasibility + user effort preference. */
export interface BasicSearchParams {
  /**
   * Picker value to display. Falls back to {@link EXACT_FALLBACK_EFFORT} when
   * "exact" is selected but enumeration is infeasible, so the segmented control
   * never highlights an option that isn't offered. The raw `basicEffort` state
   * is left untouched so restoring a feasible pool re-selects "exact".
   */
  displayEffort: BasicEffort;
  /** Heuristic effort passed to runSearch — governs only the heuristic phase. */
  heuristicEffort: HeuristicEffort;
  /** Basic UI never strips pool-resolved hard color constraints. */
  forceHeuristic: false;
  /**
   * Whether the orchestrator will run exhaustive exact enumeration: the user
   * picked "exact" AND it is feasible (color targets enforceable + within the
   * exact cap).
   */
  willRunExact: boolean;
  /**
   * exactCap to pass to buildPresetSearchOptions:
   *  • DEFAULT_EXACT_CAP when enumerating ("exact" selected + feasible).
   *  • 0 otherwise → the orchestrator skips Phase-2 enumeration but KEEPS any
   *    hard color constraints, so the heuristic phase still enforces exact
   *    colors when feasible. This is what decouples color matching (Concept A,
   *    automatic) from the enumeration-vs-heuristic strategy (Concept B).
   */
  exactCap: number;
}

/**
 * Map Beginner/Basic UI state to the search the engine should run.
 *
 * Two independent concepts:
 *  • Concept A — exact COLOR matching (hard constraints): pool-driven. Whenever
 *    {@link resolveColorSearchMode} says the meta targets are enforceable,
 *    buildPresetSearchOptions keeps them as hard constraints (forceHeuristic is
 *    always false here). This applies on ANY effort, so even a Balanced
 *    heuristic search enforces exact colors when feasible.
 *  • Concept B — effort/strategy: "exact" runs exhaustive enumeration (only
 *    when feasible); "quick"/"normal"/"thorough" run the heuristic at that
 *    effort. We express "heuristic but keep hard constraints" by passing
 *    exactCap=0 (skip enumeration, retain constraints).
 */
export function resolveBasicSearchParams(
  basicEffort: BasicEffort,
  resolution: ColorSearchResolution | null,
): BasicSearchParams {
  const exactFeasible = resolution?.willRunExact ?? false;
  const willRunExact = basicEffort === "exact" && exactFeasible;
  const displayEffort: BasicEffort =
    basicEffort === "exact" && !exactFeasible ? EXACT_FALLBACK_EFFORT : basicEffort;
  const heuristicEffort: HeuristicEffort =
    displayEffort === "exact" ? EXACT_FALLBACK_EFFORT : displayEffort;
  return {
    displayEffort,
    heuristicEffort,
    forceHeuristic: false,
    willRunExact,
    exactCap: willRunExact ? DEFAULT_EXACT_CAP : 0,
  };
}

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
   * Grade-aware loadout count from countConstrainedBuilds (UI display).
   *  • bigint > 0n → that many color-feasible builds exist.
   *  • 0n → infeasible on this pool.
   *  • null → DP overflow (too many to count) OR targets not enforceable.
   */
  constrainedBuildCount: bigint | null;
  /**
   * Pokémon-name enumeration space from countExactEnumerationSpace — what
   * exactColor actually iterates (aligned with kPrefix / parallel shards).
   */
  exactEnumerationCount: bigint | null;
  /**
   * Whether the orchestrator will actually run exact enumeration for this
   * resolution under DEFAULT_EXACT_CAP. False when weighted, when the enum
   * count overflowed (null), or when it exceeds the cap → heuristic fallback.
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
  enumerateGradeVariants = false,
): ColorSearchResolution {
  const weighted = (constrainedBuildCount: bigint | null): ColorSearchResolution => ({
    mode: "weighted",
    colorConstraints: null,
    constrainedBuildCount,
    exactEnumerationCount: null,
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
  const exactEnumerationCount = countExactEnumerationSpace(
    pool,
    targets,
    slots,
    enumerateGradeVariants,
  );

  // 0n → no build can satisfy the exact counts → soft steering only.
  if (constrainedBuildCount === 0n) return weighted(0n);

  // Feasible (count > 0n) OR DP overflow (null). Both set the constraints as
  // hard targets — exactly as Expert did. The orchestrator then decides exact
  // vs heuristic via shouldRunExact on the name-only enum space (not the
  // grade-inflated display count).
  return {
    mode: "exact",
    colorConstraints: new Map(targets),
    constrainedBuildCount,
    exactEnumerationCount,
    willRunExact: shouldRunExact(exactEnumerationCount, DEFAULT_EXACT_CAP),
  };
}

/** Advanced Exact-color UI defaults derived from a Pokémon + pool. */
export interface AdvancedColorUiDefaults {
  colorMode: "off" | ColorSearchMode;
  activeColors: EmblemColor[];
  colorCounts: Map<EmblemColor, number>;
}

/**
 * Derive the Advanced-mode color UI state (mode, checked colors, counts) from a
 * Pokémon's meta targets and the pool the search will actually run on.
 *
 * Powers `syncAdvancedFromBasic` / Pokémon-change sync in EmblemOptimizer.
 */
export function deriveAdvancedColorUiDefaults(
  pokemon: Pokemon | null,
  pool: EmblemCandidate[],
  emblems: Emblem[],
): AdvancedColorUiDefaults {
  const cleared = (): AdvancedColorUiDefaults => ({
    colorMode: "off",
    activeColors: [],
    colorCounts: new Map(),
  });

  if (!pokemon) return cleared();

  // Prefer the per-Pokémon preset color shell (keeps Advanced color defaults in
  // lock-step with the Basic preset search); fall back to the generic meta.
  const resolved = resolveEmblemPreset(pokemon);
  const byId = new Map(emblems.map((e) => [e.id, e]));
  const targets = resolved ? presetColorTargets(resolved.preset) : colorTargetsFor(pokemon, byId);
  if (targets.size === 0) return cleared();

  const resolution = resolveColorSearchMode(pool, targets, SLOTS);
  return {
    colorMode: resolution.mode,
    activeColors: [...targets.keys()],
    colorCounts: new Map(targets),
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
   * chosen effort instead — only when the user picked a time-based effort AND
   * exact enumeration is actually feasible (within cap). When targets are
   * feasible but over-cap, callers should pass false so the heuristic still
   * enforces hard constraints. The soft color-bonus incentive (colorBonuses)
   * steers the heuristic when constraints are stripped. Defaults to false.
   */
  forceHeuristic?: boolean;
  /**
   * Exact-enumeration budget passed through to SearchOptions. Pass 0 to keep
   * any hard color constraints but force the heuristic phase (the orchestrator
   * only enumerates when the constrained build count is ≤ this cap). Defaults
   * to {@link DEFAULT_EXACT_CAP}.
   */
  exactCap?: number;
  /** When true, exact search enumerates all grade combos per name set. */
  enumerateGradeVariants?: boolean;
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
 * on `pool` (otherwise soft color-bonus steering). With the default exactCap
 * (1B) exact enumeration runs whenever the constrained build count is countable
 * and within budget — identical to an Expert search with auto defaults. Pass
 * exactCap=0 to keep the hard constraints but force the heuristic phase.
 */
export function buildPresetSearchOptions(params: BuildPresetParams): PresetSearchBuild {
  const {
    pokemon,
    level,
    pool,
    emblems,
    pokemonList = [],
    forceHeuristic = false,
    exactCap = DEFAULT_EXACT_CAP,
    enumerateGradeVariants = false,
  } = params;
  const resolved = resolveEmblemPreset(pokemon);
  const objective = deriveBasicObjective(
    pokemon,
    level,
    emblems,
    pokemonList,
    resolved?.preset ?? null,
  );
  const targets = objective.colorTargets as Map<EmblemColor, number>;
  const resolution = resolveColorSearchMode(pool, targets, SLOTS, enumerateGradeVariants);

  // forceHeuristic drops hard constraints only when the caller signals the user
  // deliberately skipped exact while enumeration was feasible; colorBonuses
  // still steers softly when constraints are stripped.
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
    exactCap,
    enumerateGradeVariants,
  };

  return { options, resolution, objective };
}
