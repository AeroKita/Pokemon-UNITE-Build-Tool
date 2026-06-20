import type { EmblemPick } from "../../state/loadout";
import type { EmblemSearchState } from "../../state/emblemSearch";
import type { BasicEffort } from "../../engine/emblemSearch/searchPresets";
import type { ColorBonusPreviewItem } from "../../engine/emblemSearch/colorBonusPreview";
import type { FlatStatPrediction } from "../../engine/emblemSearch/predictStats";
import type { ResolvedEmblemPreset } from "../../engine/emblemSearch/optimizerPresets";
import type { EmblemCandidate, SearchMode } from "../../engine/emblemSearch/types";
import type { EmblemColor, EmblemGrade, StatBlock } from "../../types";
import type { pokemonById } from "../../data/gameData";
import { EMBLEM_COLOR_HEX } from "../../ui/colors";
import type { SearchResult } from "../../engine/emblemSearch/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SLOTS = 10;

export const WEIGHT_UI_MAX = 5;

export const PHASE_LABEL: Record<string, string> = {
  recipe: "Recipe match",
  exact: "Exact search",
  heuristic: "Smart search",
  none: "Search",
};

export type Effort = "quick" | "normal" | "thorough";

export type ColorMode = "off" | "exact" | "weighted";

export const POSITIVE_COLORS: EmblemColor[] = [
  "brown",
  "green",
  "blue",
  "purple",
  "white",
  "red",
  "yellow",
  "black",
];

export const PROTECT_STATS: Array<[string, string]> = [
  ["hp", "HP"],
  ["attack", "Attack"],
  ["spAttack", "Sp. Atk"],
  ["defense", "Defense"],
  ["spDefense", "Sp. Def"],
  ["critRate", "Crit Rate"],
  ["cdr", "CDR"],
  ["attackSpeed", "Atk Spd"],
  ["moveSpeed", "Move Speed"],
];

export const STAT_LABELS: Partial<Record<string, string>> = {
  hp: "HP",
  attack: "Attack",
  defense: "Defense",
  spAttack: "Sp. Attack",
  spDefense: "Sp. Defense",
  critRate: "Crit Rate",
  cdr: "CDR",
  attackSpeed: "Atk Speed",
  moveSpeed: "Move Speed",
};

export const STAT_ROW_GRID =
  "grid grid-cols-[5.25rem_minmax(0,1fr)_1.5rem] grid-rows-[auto_auto] items-center gap-x-2 gap-y-0.5";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OptimizerPokemon = ReturnType<typeof pokemonById.get> | null;

export interface AppliedState {
  emblems: boolean;
}

export interface EffectiveDelta {
  delta: Partial<Record<keyof StatBlock, number>>;
}

export interface OptimizerSharedProps {
  pokemon: OptimizerPokemon;
  searchState: EmblemSearchState;
  resultPicks: EmblemPick[] | undefined;
  effectiveDelta: EffectiveDelta | null;
  hasResult: boolean;
  historyCount: number;
  historyIndex: number;
  goHistory: (delta: number) => void;
  clearResult: () => void;
  handleApplyEmblems: () => void;
  applied: AppliedState;
  optimizeLevel: number;
  setOptimizeLevel: (level: number) => void;
  cancel: () => void;
  toast: string | null;
  searchWillRunExact: boolean;
  resultCount: number;
  setResultCount: (n: number) => void;
  allowedGrades: Set<EmblemGrade>;
  setAllowedGrades: (grades: Set<EmblemGrade>) => void;
}

export interface OptimizerBasicProps {
  basicUseOwned: boolean;
  setBasicUseOwned: (owned: boolean) => void;
  basicEffort: BasicEffort;
  setBasicEffort: (effort: BasicEffort) => void;
  basicPool: EmblemCandidate[];
  basicNotEnoughEmblems: boolean;
  resolvedBasicEffort: BasicEffort;
  basicExactColorFeasible: boolean;
  basicExactEnumFeasible: boolean;
  basicWillRunExactSearch: boolean;
  handleBasicSearch: () => void;
}

export interface OptimizerAdvancedProps {
  pool: EmblemCandidate[];
  useOwned: boolean;
  setUseOwned: (owned: boolean) => void;
  mixedGrades: boolean;
  setMixedGrades: (mixed: boolean) => void;
  /** Derived from mixedGrades — exact grade enumeration; owned pool variants follow mixedGrades. */
  enumerateGradeVariants: boolean;
  mode: SearchMode;
  setMode: (mode: SearchMode) => void;
  effort: Effort;
  setEffort: (effort: Effort) => void;
  exactCap: number;
  setExactCap: (cap: number) => void;
  colorMode: ColorMode;
  setColorMode: (mode: ColorMode) => void;
  activeColors: Set<EmblemColor>;
  setActiveColors: (colors: Set<EmblemColor>) => void;
  colorCounts: Record<EmblemColor, number>;
  setColorCounts: (
    counts:
      | Record<EmblemColor, number>
      | ((prev: Record<EmblemColor, number>) => Record<EmblemColor, number>),
  ) => void;
  colorBonuses: boolean;
  setColorBonuses: (on: boolean) => void;
  pokemonAwareScoring: boolean;
  setPokemonAwareScoring: (on: boolean) => void;
  customWeights: Record<string, number>;
  setCustomWeights: (
    weights: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>),
  ) => void;
  targetValues: Record<string, string>;
  setTargetValues: (
    values: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>),
  ) => void;
  targetActive: Record<string, boolean>;
  setTargetActive: (
    active: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>),
  ) => void;
  floorValues: Record<string, string>;
  setFloorValues: (
    values: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>),
  ) => void;
  floorActive: Record<string, boolean>;
  setFloorActive: (
    active: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>),
  ) => void;
  advancedNotEnoughEmblems: boolean;
  buildCount: bigint;
  candidateCount: number;
  poolDistinctNames: number;
  colorConstraints: Map<EmblemColor, number> | null;
  colorConstraintValid: boolean;
  constrainedBuildCount: bigint | null;
  exactEnumerationCount: bigint | null;
  willRunExact: boolean;
  colorCapacities: Map<EmblemColor, number>;
  totalColorConstrained: number;
  colorBonusPreviews: ColorBonusPreviewItem[];
  emblemPresetResolution: ResolvedEmblemPreset | null;
  priorities: Record<string, number>;
  flatStatPredictionByStat: Map<keyof StatBlock, FlatStatPrediction>;
  handleAdvancedSearch: () => void;
  syncAdvancedFromBasic: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Section-level copy when the search pool has fewer than SLOTS candidates. */
export function flatStatEstimateUnavailableMessage(
  poolCount: number,
  useOwned: boolean,
  slots = SLOTS,
): string {
  if (useOwned) {
    if (poolCount === 0) {
      return `Approx. flat stats can't be calculated — you don't own any emblems yet. You need ${slots} for a full build.`;
    }
    return `Approx. flat stats can't be calculated — you only have ${poolCount} owned emblem candidate${poolCount !== 1 ? "s" : ""} in this pool (need ${slots} for a full build).`;
  }
  return `Approx. flat stats can't be calculated — only ${poolCount} candidate${poolCount !== 1 ? "s" : ""} in the current pool (need ${slots} for a full build). Enable more grades or use the full dataset.`;
}

/** Short inline hint under a priority slider when estimates are unavailable. */
export function flatStatEstimateUnavailableHint(poolCount: number, useOwned: boolean): string {
  if (useOwned && poolCount === 0) return "Can't calculate — no owned emblems";
  if (useOwned) return "Can't calculate — not enough owned emblems";
  return "Can't calculate — pool too small";
}

export function presetAutofillIntro(
  displayName: string,
  resolved: ResolvedEmblemPreset | null,
): string {
  if (!resolved) return `Auto-filled from role defaults for ${displayName}`;
  if (resolved.source === "manual") return `Auto-filled from curated preset for ${displayName}`;
  return `Auto-filled from Recommended builds for ${displayName}`;
}

export function ColorDot({ color }: { color: EmblemColor }) {
  return (
    <span
      className="inline-block h-3 w-3 rounded-full ring-1 ring-black/10"
      style={{ background: EMBLEM_COLOR_HEX[color] }}
    />
  );
}

export function emblemPicksFromResult(result: SearchResult | null | undefined): EmblemPick[] {
  if (!result?.picks?.length) return [];
  return result.picks.flatMap((slot) => {
    const emblemId = slot.emblem?.id;
    if (!emblemId || !slot.grade) return [];
    return [{ emblemId, grade: slot.grade }];
  });
}

export function fmtDelta(stat: keyof StatBlock, delta: number): string {
  if (
    stat === "critRate" ||
    stat === "cdr" ||
    stat === "lifesteal" ||
    stat === "spLifesteal" ||
    stat === "attackSpeed"
  ) {
    return `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}%`;
  }
  if (stat === "moveSpeed") return `${delta >= 0 ? "+" : ""}${Math.round(delta)}`;
  return `${delta >= 0 ? "+" : ""}${delta % 1 === 0 ? delta : delta.toFixed(1)}`;
}
