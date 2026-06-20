/**
 * EmblemSearch engine — shared types.
 *
 * Algorithm provenance: algorithms in this module are a clean-room TypeScript
 * reimplementation inspired by the combinatorial search techniques in
 * uniteemblemfinder.github.io (AGPL-3.0). No source was copied verbatim;
 * all code is an independent port to the FoxForge-GG type system.
 */

import type {
  EmblemColor,
  EmblemGrade,
  EmblemSlot,
  HeldItem,
  Pokemon,
  StatBlock,
} from "../../types";

// ---------------------------------------------------------------------------
// Pokémon scoring context — serializable, worker-safe
// ---------------------------------------------------------------------------

/**
 * Precomputed Pokémon context for inner-loop scoring.
 * Fully serializable — safe to post to a Web Worker.
 */
export interface PokemonScoringContext {
  pokemonId: string;
  level: number;
  /** pokemon.baseStatsByLevel[level - 1] — base stat block at this level */
  baseStats: StatBlock;
}

// ---------------------------------------------------------------------------
// Candidate — a single emblem+grade as the search engine sees it
// ---------------------------------------------------------------------------

/** A flat representation of one emblem at a specific grade, ready for scoring. */
export interface EmblemCandidate {
  /** emblem.id */
  id: string;
  /** emblem.pokemonName — used for the distinct-Pokémon constraint */
  pokemonName: string;
  grade: EmblemGrade;
  colors: EmblemColor[];
  /** Raw flat stats for this grade (same keys as StatBlock) */
  stats: Partial<StatBlock>;
}

// ---------------------------------------------------------------------------
// Search options
// ---------------------------------------------------------------------------

export type SearchMode = "maximize" | "target";

/** Priorities used in maximize mode: keys from StatBlock, values are weights. */
export type StatWeights = Partial<Record<keyof StatBlock, number>>;

/** Target stat values (target mode): stat → desired total flat value. */
export type StatTargets = Partial<Record<keyof StatBlock, number>>;

/** Which targets are enabled (target mode). */
export type StatTargetActive = Partial<Record<keyof StatBlock, boolean>>;

/** Floor constraints: stat must not drop below this total flat value. */
export type StatFloors = Partial<Record<keyof StatBlock, number>>;

export interface SearchOptions {
  mode: SearchMode;

  /** Maximize mode: stat → weight. Higher = more important. */
  priorities: StatWeights;

  /** Target mode: desired flat stat totals. */
  targets: StatTargets;

  /** Target mode: which stats are active targets. */
  targetActive: StatTargetActive;

  /** Floors for any stat (maximize + target); violations add a large penalty. */
  protected: StatFloors;

  /**
   * Exact color counts required (null = no constraint). Each entry is
   * [color, exact count needed in the 10-slot set].
   */
  colorConstraints: Map<EmblemColor, number> | null;

  /**
   * Whether to include a color set-bonus incentive in the maximize score.
   * True → hitting higher set-bonus tiers adds to the score.
   */
  colorBonuses: boolean;

  /**
   * "pokemon" = scale color-bonus incentive by the Pokémon's actual base stats
   * so % bonuses are correctly valued relative to flat gains.
   * "classic" = uniform abstract weights (default, backward-compatible).
   */
  scoringMode?: "pokemon" | "classic";

  /**
   * Required when scoringMode === "pokemon".
   * Precomputed once per search run; passed serialized to the Web Worker.
   */
  pokemonContext?: PokemonScoringContext;

  /** How many slots to fill (always 10 for UNITE). */
  slots: number;

  /**
   * Maximum number of color-feasible builds to enumerate in the exact
   * color-constrained search before falling back to the heuristic.
   * Measured against the exact enumeration space (Pokémon-name combos when
   * enumerateGradeVariants is false; grade-aware loadouts when true).
   * Defaults to 1_000_000_000 when omitted. Only relevant when
   * colorConstraints is non-null.
   */
  exactCap?: number;

  /**
   * When true, exact search enumerates every grade assignment for each valid
   * 10-name combo (product of variant counts). When false, one grade per name
   * is chosen via bestVariantForMode (fast path). Full-dataset searches should
   * default to true (mixed grades UI toggle, on by default for owned and full pools).
   */
  enumerateGradeVariants?: boolean;
}

// ---------------------------------------------------------------------------
// Pool config
// ---------------------------------------------------------------------------

export interface PoolConfig {
  /** true = restrict to owned emblems; false = full dataset. */
  useOwned: boolean;
  /**
   * When useOwned=true: include all owned grade variants per Pokémon (true)
   * or only the best-owned grade (false). Defaults to true (mixed).
   * When useOwned=false: ignored — allowedGrades controls which grades appear.
   */
  mixedGrades: boolean;
  /** When useOwned=false, which grades to include. Ignored when useOwned=true. */
  allowedGrades: Set<EmblemGrade>;
}

// ---------------------------------------------------------------------------
// Progress and results
// ---------------------------------------------------------------------------

export interface SearchProgress {
  pct: number; // 0–100
  label: string;
  candidates?: number; // loadouts evaluated so far
  /** Total builds to enumerate (exact search only). */
  totalCandidates?: number;
}

export interface SearchResult {
  picks: EmblemSlot[];
  /** Internal search score (not the same as effective-stat score). */
  score: number;
  /** Target-mode only: residual error (0 = exact). */
  error?: number;
  candidates: number;
  totalMs: number;
  /** Which phase found the best result. */
  phase: string;
  exact?: boolean;
}

// ---------------------------------------------------------------------------
// High-level request (sent from UI / hook to orchestrator)
// ---------------------------------------------------------------------------

export interface EmblemSearchRequest {
  pokemon: Pokemon;
  level: number;
  items: HeldItem[];
  itemGrades: number[];
  pool: EmblemCandidate[];
  options: SearchOptions;
  /** Controls effort/time budget. */
  effort: "quick" | "normal" | "thorough";
}
