/**
 * EmblemOptimizer — the "⚡ Optimize" page.
 *
 * Two experience levels:
 *
 *  BEGINNER (default)
 *    Single "Find Best Build" button. The engine auto-derives objectives from
 *    the selected Pokémon's role/attack type using recommend.ts meta-knowledge.
 *    Pool defaults to owned emblems only; user can toggle to the full dataset.
 *    Grade checkboxes (full dataset) control which grades are in play; grades
 *    are always mixed (the optimal behavior). The binary mixed-grades toggle
 *    lives only in Expert mode.
 *    Shows results: emblem icons, emblem set summary, effective-stat delta,
 *    and Apply button. Prior search generations can be browsed with ‹ › tabs.
 *
 *  EXPERT
 *    Full custom controls: pool source, mode (maximize/target), effort, level,
 *    Pokémon-aware scoring toggle, color constraints, stat priorities/targets.
 *    Pool defaults to owned emblems only (same as Beginner); user can toggle to
 *    the full dataset. Pre-filled from Beginner auto-derived values when switching.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { EmblemPick } from "../state/loadout";
import {
  emblems as allEmblems,
  heldItemById,
  emblemById,
  setBonuses,
  pokemonById,
  pokemonList,
} from "../data/gameData";
import { buildPool, approximateBuildCount, formatBuildCount, countConstrainedBuilds, distinctPokemonCount } from "../engine/emblemSearch/pool";
import { colorGroupSizes } from "../engine/emblemSearch/exactColor";
import { DEFAULT_EXACT_CAP, shouldRunExact } from "../engine/emblemSearch/orchestrator";
import {
  proposedColorBonuses,
  concreteBonusDelta,
  BONUS_STAT_LABELS,
  type ColorBonusPreviewItem,
} from "../engine/emblemSearch/colorBonusPreview";
import {
  useEmblemSearch,
  buildSearchSettingsKey,
  clampResultCount,
  DEFAULT_RESULT_COUNT,
  RESULT_COUNT_MAX,
  RESULT_COUNT_MIN,
} from "../state/emblemSearch";
import { priorityWeights } from "../engine/recommend";
import {
  deriveBasicObjective,
  buildBasicPool,
  BASIC_POOL_DEFAULTS,
  DEFAULT_ALLOWED_GRADES,
} from "../engine/emblemSearch/basicObjective";
import { buildPresetSearchOptions, deriveAdvancedColorUiDefaults, resolveBasicSearchParams, resolveColorSearchMode, type BasicEffort } from "../engine/emblemSearch/searchPresets";
import { deriveProtectFloors } from "../engine/emblemSearch/protectDefaults";
import {
  presetPriorities,
  presetProtectFloors,
  resolveEmblemPreset,
  type ResolvedEmblemPreset,
} from "../engine/emblemSearch/optimizerPresets";
import { predictFlatStatRanges, type FlatStatPrediction } from "../engine/emblemSearch/predictStats";
import type {
  PokemonScoringContext,
  SearchOptions,
  SearchMode,
  PoolConfig,
  SearchResult,
} from "../engine/emblemSearch/types";
import type { EmblemColor, EmblemGrade, HeldItem, StatBlock } from "../types";
import { computeEmblemLoadout } from "../engine/emblems";
import { computeEffectiveStats } from "../engine/formulas";
import { CollapsibleCard } from "./CollapsibleCard";
import { Segmented } from "./Segmented";
import { EmblemSetSummary } from "./EmblemSetSummary";
import { SearchProgressOverlay } from "./SearchProgressOverlay";
import { Tooltip } from "./Tooltip";
import { emblemTip } from "./tips";
import { EMBLEM_COLOR_HEX, GRADE_LETTER } from "../ui/colors";
import { emblemIconForGrade } from "../ui/emblemIcon";
import { asset } from "../ui/asset";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SLOTS = 10;

// The engine's role-derived priority weights span ~0–6 (e.g. Defender HP = 6).
// The Advanced slider presents a clean 0–1 "importance" scale instead; this is
// the divisor mapping engine weight ↔ slider value (slider 1.0 = engine weight
// WEIGHT_UI_MAX). Purely a display transform — the scoring engine is untouched.
const WEIGHT_UI_MAX = 5;

// Friendly labels for the internal search-phase tag (avoids surfacing the word
// "heuristic", which testers found confusing).
const PHASE_LABEL: Record<string, string> = {
  recipe: "recipe match",
  exact: "exact search",
  heuristic: "smart search",
  none: "search",
};

type Effort = "quick" | "normal" | "thorough";

type ColorMode = "off" | "exact" | "weighted";

const POSITIVE_COLORS: EmblemColor[] = ["brown", "green", "blue", "purple", "white", "red", "yellow", "black"];

/** Stats surfaced in the Protect Floors control (same stats protect is meaningful for). */
const PROTECT_STATS: Array<[string, string]> = [
  ["hp",        "HP"],
  ["attack",    "Attack"],
  ["spAttack",  "Sp. Atk"],
  ["defense",   "Defense"],
  ["spDefense", "Sp. Def"],
  ["critRate",  "Crit Rate"],
  ["cdr",       "CDR"],
  ["attackSpeed", "Atk Spd"],
  ["moveSpeed", "Move Speed"],
];

const STAT_LABELS: Partial<Record<string, string>> = {
  hp: "HP", attack: "Attack", defense: "Defense", spAttack: "Sp. Attack",
  spDefense: "Sp. Defense", critRate: "Crit Rate", cdr: "CDR",
  attackSpeed: "Atk Speed", moveSpeed: "Move Speed",
};

/** Advanced UI copy for where preset defaults came from (Recommended builds, curated, or role). */
function presetAutofillIntro(displayName: string, resolved: ResolvedEmblemPreset | null): string {
  if (!resolved) return `Auto-filled from role defaults for ${displayName}`;
  if (resolved.source === "manual") return `Auto-filled from curated preset for ${displayName}`;
  return `Auto-filled from Recommended builds for ${displayName}`;
}

/** Shared label column for stat rows — fits longest name ("Sp. Defense") without old w-24 gap. */
const STAT_ROW_GRID =
  "grid grid-cols-[5.25rem_minmax(0,1fr)_1.5rem] grid-rows-[auto_auto] items-center gap-x-2 gap-y-0.5";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ColorDot({ color }: { color: EmblemColor }) {
  return (
    <span
      className="inline-block h-3 w-3 rounded-full ring-1 ring-black/10"
      style={{ background: EMBLEM_COLOR_HEX[color] }}
    />
  );
}

/** Map optimizer search slots → loadout emblem picks (worker-safe). */
function emblemPicksFromResult(result: SearchResult | null | undefined): EmblemPick[] {
  if (!result?.picks?.length) return [];
  return result.picks.flatMap((slot) => {
    const emblemId = slot.emblem?.id;
    if (!emblemId || !slot.grade) return [];
    return [{ emblemId, grade: slot.grade }];
  });
}

function fmtDelta(stat: keyof StatBlock, delta: number): string {
  if (stat === "critRate" || stat === "cdr" || stat === "lifesteal" || stat === "spLifesteal" || stat === "attackSpeed") {
    return `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}%`;
  }
  if (stat === "moveSpeed") return `${delta >= 0 ? "+" : ""}${Math.round(delta)}`;
  return `${delta >= 0 ? "+" : ""}${delta % 1 === 0 ? delta : delta.toFixed(1)}`;
}

/** Inline estimate under a priority slider — sign is color-coded for quick scanning. */
function PriorityFlatEstimate({ stat, pred, weight }: { stat: keyof StatBlock; pred?: FlatStatPrediction; weight: number }) {
  if (stat === "cdr") {
    return <span className="text-faint">from black set bonus, not flat emblems</span>;
  }
  if (!pred) {
    return <span className="text-faint">no priority</span>;
  }
  const protectedOnly = weight <= 0 && pred.weight <= 0;
  const v = pred.predicted;
  const signClass = v > 0 ? "text-pos" : v < 0 ? "text-neg" : "text-muted";
  return (
    <>
      <span className="text-faint">Approx. </span>
      <span className={`font-mono font-semibold tabular-nums ${signClass}`}>
        {fmtDelta(stat, v)}
      </span>
      <span className="text-faint">
        {protectedOnly ? " from emblems (minimum only)" : " from emblems"}
      </span>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared result panels (used by both Beginner and Expert)
// ---------------------------------------------------------------------------

/** Whether the current result's emblems have been applied to the loadout. */
interface AppliedState {
  emblems: boolean;
}

interface ResultPanelProps {
  picks: { emblemId: string; grade: EmblemGrade }[];
  effectiveDelta: EffectiveDelta | null;
  searchResult: { phase: string; candidates: number; totalMs: number; error?: number } | null;
  pokemon: ReturnType<typeof pokemonById.get> | null;
  optimizeLevel: number;
  pokemonAwareScoring: boolean;
  applied: AppliedState;
  historyCount: number;
  historyIndex: number;
  onGoHistory: (delta: number) => void;
  onApplyEmblems: () => void;
}

interface EffectiveDelta {
  delta: Partial<Record<keyof StatBlock, number>>;
}

function ResultCards({
  picks,
  effectiveDelta,
  searchResult,
  pokemon,
  optimizeLevel,
  pokemonAwareScoring,
  applied,
  historyCount,
  historyIndex,
  onGoHistory,
  onApplyEmblems,
}: ResultPanelProps) {
  return (
    <CollapsibleCard title="Results" persistKey="optimizer-results" tone="indigo">
      <div className="flex flex-col gap-4">
        {/* Generation navigation — mirrors RecommendPanel build variant arrows */}
        {historyCount > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onGoHistory(-1)}
              disabled={historyIndex <= 0}
              aria-label="Previous build"
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-line text-lg text-ink hover:bg-raise disabled:opacity-30"
            >
              ‹
            </button>
            <p className="min-w-0 flex-1 truncate text-center text-xs text-muted">
              <span className="font-semibold text-ink">Build {historyIndex + 1}</span>
              {historyCount > 1 ? ` · ${historyIndex + 1}/${historyCount}` : ""}
            </p>
            <button
              type="button"
              onClick={() => onGoHistory(1)}
              disabled={historyIndex >= historyCount - 1}
              aria-label="Next build"
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-line text-lg text-ink hover:bg-raise disabled:opacity-30"
            >
              ›
            </button>
          </div>
        )}

        {/* Emblems — matches RecommendPanel / build page section layout */}
        <div className="flex flex-col gap-2.5">
          <p className="text-xs font-medium text-faint">Emblems</p>
          <div className="flex flex-wrap gap-1">
            {picks.map((p, i) => {
              const emblem = emblemById.get(p.emblemId);
              if (!emblem) return null;
              return (
                <Tooltip key={i} content={emblemTip(emblem, p.grade)}>
                  <span className="relative inline-block">
                    <img
                      src={asset(emblemIconForGrade(emblem, p.grade))}
                      alt={emblem.pokemonName}
                      className="h-16 w-16 object-contain"
                    />
                    <span className="absolute -bottom-0.5 -right-0.5 rounded bg-neutral-800 px-0.5 text-[9px] font-bold text-white">
                      {GRADE_LETTER[p.grade]}
                    </span>
                    <span className="absolute -left-1 -top-1 flex gap-0.5">
                      {emblem.colors.map((c) => (
                        <span
                          key={c}
                          className="h-2.5 w-2.5 rounded-full ring-1 ring-white"
                          style={{ background: EMBLEM_COLOR_HEX[c] }}
                        />
                      ))}
                    </span>
                  </span>
                </Tooltip>
              );
            })}
          </div>
        </div>

        <EmblemSetSummary picks={picks} />

        {/* Effective-stat delta — layout matches build Effective Stats panel */}
        {effectiveDelta && Object.keys(effectiveDelta.delta).length > 0 && pokemon && (
          <div>
            <p className="mb-2 text-xs font-medium text-faint">
              Stat gains at {pokemon.displayName} Lv.{optimizeLevel}
              {pokemonAwareScoring && <span className="ml-1 text-accent-ink">· Pokémon-aware</span>}
            </p>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-0 sm:grid-cols-3">
              {(Object.entries(effectiveDelta.delta) as [keyof StatBlock, number][])
                .filter(([k]) => STAT_LABELS[k])
                .map(([stat, delta]) => (
                  <div key={stat} className="flex items-baseline justify-between border-b border-line-soft py-1">
                    <dt className="text-sm text-muted">{STAT_LABELS[stat]}</dt>
                    <dd className={`font-mono text-sm font-semibold ${delta >= 0 ? "text-pos" : "text-neg"}`}>
                      {fmtDelta(stat, delta)}
                    </dd>
                  </div>
                ))}
            </dl>
          </div>
        )}

        {/* Target error */}
        {searchResult?.error !== undefined && (
          <p className="text-xs text-muted">
            Target error:{" "}
            <span className={`font-mono ${searchResult.error < 0.01 ? "text-pos" : "text-neg"}`}>
              {searchResult.error.toFixed(3)}
            </span>
            {searchResult.error < 0.01 && " (exact)"}
          </p>
        )}

        {/* Apply emblems */}
        <div className="flex flex-col gap-4 border-t border-line-soft pt-4">
          <button
            type="button"
            onClick={onApplyEmblems}
            className="flex min-h-11 w-full items-center justify-center rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-accent/90 active:scale-[0.98] sm:w-auto"
          >
            {applied.emblems ? "Applied ✓ — Re-apply Emblems" : "Apply Emblems"}
          </button>
          <p className="text-xs text-faint">
            Applies to your current loadout without leaving this page. Switch to the Build tab
            anytime to review.
          </p>
        </div>
      </div>
    </CollapsibleCard>
  );
}

/**
 * Mobile-friendly per-color count input (Expert mode color section).
 *
 * Uses type="text" + inputMode="numeric" so iOS shows the numeric keypad and
 * there are no native spinner quirks. Digits-only filtering keeps it numeric.
 * A draft string lets the user clear the field and retype without it snapping
 * back to 0 mid-edit; the value is clamped to [0, max] only on commit (blur).
 * text-base (>=16px) prevents iOS focus auto-zoom.
 */
function ColorCountField({
  value,
  max,
  onCommit,
  label,
}: {
  value: number;
  max: number;
  onCommit: (n: number) => void;
  label: string;
}) {
  const [draft, setDraft] = useState(String(value));

  // Re-sync when the committed value changes from the outside (reset, presets).
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const onChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "");
    setDraft(digits);
    // Empty stays empty (no snap to 0); only commit when there's an actual number.
    if (digits !== "") onCommit(Number(digits));
  };

  const commit = () => {
    const clamped = Math.max(0, Math.min(max, Number(draft) || 0));
    setDraft(String(clamped));
    onCommit(clamped);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft}
      onChange={(e) => onChange(e.target.value)}
      onBlur={commit}
      aria-label={`${label} count`}
      className="min-h-11 w-14 rounded bg-surface px-1 py-0.5 text-center font-mono text-base text-ink ring-1 ring-line focus:outline-none focus:ring-accent sm:min-h-0 sm:w-12 sm:py-1"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

/** Heuristic-only: how many independent smart-search runs to generate per click. */
function VariationsControl({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (digits === "") {
      setDraft(String(DEFAULT_RESULT_COUNT));
      onChange(DEFAULT_RESULT_COUNT);
      return;
    }
    const n = clampResultCount(Number(digits));
    setDraft(String(n));
    onChange(n);
  };

  const step = (delta: number) => {
    const next = clampResultCount(value + delta);
    setDraft(String(next));
    onChange(next);
  };

  return (
    <div className={`flex flex-col gap-1.5 ${disabled ? "opacity-50" : ""}`}>
      <span className="text-xs font-medium text-muted">Variations</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Fewer variations"
          disabled={disabled || value <= RESULT_COUNT_MIN}
          onClick={() => step(-1)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-raise text-sm font-semibold text-ink ring-1 ring-line hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          −
        </button>
        <input
          type="text"
          inputMode="numeric"
          id="search-variations"
          aria-label="Variations to generate"
          disabled={disabled}
          value={draft}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "");
            setDraft(digits);
            if (digits !== "") onChange(clampResultCount(Number(digits)));
          }}
          onBlur={(e) => commit(e.target.value)}
          className="w-14 rounded-lg bg-surface px-1 py-1.5 text-center font-mono text-sm text-ink ring-1 ring-line focus:outline-none focus:ring-accent disabled:cursor-not-allowed"
        />
        <button
          type="button"
          aria-label="More variations"
          disabled={disabled || value >= RESULT_COUNT_MAX}
          onClick={() => step(1)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-raise text-sm font-semibold text-ink ring-1 ring-line hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          +
        </button>
      </div>
      <p className="text-xs text-faint">
        {disabled
          ? "Exact search returns one optimal build."
          : "Run smart search multiple times to compare different builds."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EmblemOptimizer({ onNavigate }: { onNavigate?: (page: string) => void } = {}) {
  const { loadout, dispatch, owned, heldSlotGrades, expert, setMode: setViewMode } = useStore();
  const pokemon = loadout.pokemonId ? pokemonById.get(loadout.pokemonId) ?? null : null;

  // ---- Pool state (Beginner vs Expert pool source are independent) ----
  const [basicUseOwned, setBasicUseOwned] = useState(BASIC_POOL_DEFAULTS.useOwned);
  const [useOwned, setUseOwned] = useState(BASIC_POOL_DEFAULTS.useOwned);
  const [mixedGrades, setMixedGrades] = useState(true);
  const [allowedGrades, setAllowedGrades] = useState<Set<EmblemGrade>>(
    () => new Set(DEFAULT_ALLOWED_GRADES),
  );
  const [mode, setMode] = useState<SearchMode>("maximize");
  const [effort, setEffort] = useState<Effort>("normal");
  // Beginner effort is independent of the Expert `effort`. It is purely the
  // heuristic search-quality tier (Fast/Balanced/Thorough) and is orthogonal to
  // color matching — exact color enforcement is pool-driven and applied
  // automatically when feasible (see basicWillRunExactSearch). Defaults to
  // "normal" (Balanced).
  const [basicEffort, setBasicEffort] = useState<BasicEffort>("normal");
  const [colorBonuses, setColorBonuses] = useState(true);
  const [optimizeLevel, setOptimizeLevel] = useState<number>(15);
  const [pokemonAwareScoring, setPokemonAwareScoring] = useState(true);
  const [customWeights, setCustomWeights] = useState<Record<string, number>>({});
  const [colorMode, setColorMode] = useState<ColorMode>("off");
  const [colorCounts, setColorCounts] = useState<Record<EmblemColor, number>>(
    Object.fromEntries(POSITIVE_COLORS.map((c) => [c, 0])) as Record<EmblemColor, number>,
  );
  const [activeColors, setActiveColors] = useState<Set<EmblemColor>>(new Set());
  const [targetValues, setTargetValues] = useState<Record<string, string>>({});
  const [targetActive, setTargetActive] = useState<Record<string, boolean>>({});
  const [floorActive, setFloorActive] = useState<Record<string, boolean>>({});
  const [floorValues, setFloorValues] = useState<Record<string, string>>({});
  const [exactCap, setExactCap] = useState<number>(DEFAULT_EXACT_CAP);
  const [resultCount, setResultCount] = useState(DEFAULT_RESULT_COUNT);

  // ---- Pool ----
  const poolConfig: PoolConfig = { useOwned, mixedGrades, allowedGrades };
  const pool = useMemo(
    () => buildPool(allEmblems, poolConfig, owned),
    [useOwned, mixedGrades, allowedGrades, owned],
  );
  const buildCount = useMemo(() => approximateBuildCount(pool, SLOTS), [pool]);
  // candidateCount = pool.length = total grade-variant entries; changes when
  // allowedGrades / mixedGrades change. Gives the user visible feedback that
  // grade selection is actually affecting the pool the optimizer uses.
  const candidateCount = pool.length;
  // Distinct Pokémon names (grade-independent) used for the combination count
  // label so the user understands the two dimensions.
  const poolDistinctNames = useMemo(() => distinctPokemonCount(pool), [pool]);

  // Beginner mode always allows mixed grades: an owned pool inherently mixes
  // whatever grades you own, and mixed grades are optimal for the full dataset
  // too. The binary mixed-grades toggle is exposed only in Expert mode.
  const basicPoolConfig: PoolConfig = { useOwned: basicUseOwned, mixedGrades: true, allowedGrades };
  const basicPool = useMemo(
    () => buildBasicPool(allEmblems, owned, basicPoolConfig),
    [owned, basicUseOwned, allowedGrades],
  );

  // Pool size guards — need SLOTS emblem entries for a full build.
  const basicNotEnoughEmblems = basicPool.length < SLOTS;
  const advancedNotEnoughEmblems = pool.length < SLOTS;

  // ---- Auto-derived Beginner objective ----
  // Pass pokemonList so protect floors are derived from population statistics.
  // pokemonList is a module-level constant (doesn't change) so it's safe to
  // omit from the dep array per the React rules-of-hooks exhaustive-deps advice
  // for stable references.
  const basicObjective = useMemo(() => {
    if (!pokemon) return null;
    return deriveBasicObjective(
      pokemon,
      optimizeLevel,
      allEmblems,
      pokemonList,
      resolveEmblemPreset(pokemon)?.preset ?? null,
    );
  }, [pokemon, optimizeLevel]);

  // Resolve exact-vs-heuristic for Beginner on the ACTUAL Beginner pool, using
  // the same shared resolver the search itself uses — so the indicator can
  // never drift from real engine behavior.
  const basicColorResolution = useMemo(() => {
    if (!basicObjective) return null;
    return resolveColorSearchMode(
      basicPool,
      basicObjective.colorTargets as Map<EmblemColor, number>,
      SLOTS,
    );
  }, [basicObjective, basicPool]);

  // Concept A — exact COLOR matching feasible: the meta targets are enforceable
  // on the pool as hard constraints (capacity + a feasible build exists), even
  // if the constrained count is over the enumeration cap. When true the engine
  // enforces hard color constraints automatically on ANY effort.
  const basicExactColorFeasible = basicColorResolution?.mode === "exact";

  // Concept B — exhaustive exact ENUMERATION feasible: color-feasible AND within
  // the exact cap. Drives whether the "Exact" effort button is offered.
  const basicExactEnumFeasible = basicColorResolution?.willRunExact ?? false;

  // Pool-driven Basic search wiring. Hard color constraints are always kept when
  // feasible (forceHeuristic === false). Enumeration vs heuristic is the user's
  // effort choice, expressed via exactCap (0 keeps constraints but skips
  // enumeration). resolvedBasicEffort is the picker value (falls back off
  // "exact" when enumeration is infeasible, without mutating the stored choice).
  const basicSearchParams = useMemo(
    () => resolveBasicSearchParams(basicEffort, basicColorResolution),
    [basicEffort, basicColorResolution],
  );
  const { displayEffort: resolvedBasicEffort, willRunExact: basicWillRunExactSearch } = basicSearchParams;

  // ---- Expert weights + context ----
  // Advanced defaults (priorities, floors, colors) use the per-Pokémon preset when
  // one exists; otherwise the role-generic derivation. Source is surfaced in UI copy.
  const emblemPresetResolution = useMemo(
    () => (pokemon ? resolveEmblemPreset(pokemon) : null),
    [pokemon],
  );
  const defaultWeights = useMemo(() => {
    if (!pokemon) return {};
    return emblemPresetResolution
      ? presetPriorities(emblemPresetResolution.preset)
      : priorityWeights(pokemon);
  }, [pokemon, emblemPresetResolution]);
  const priorities = useMemo(() => ({ ...defaultWeights, ...customWeights }), [defaultWeights, customWeights]);

  // Predicted flat emblem-stat totals per prioritized stat, shown inline beside
  // the Advanced priority sliders so the user sees what each weight produces.
  // Honors the active color shell (any non-off mode) so the estimate reflects the
  // constrained outcome the search will produce, not an unconstrained one.
  const flatStatPredictionByStat = useMemo(() => {
    const m = new Map<keyof StatBlock, FlatStatPrediction>();
    if (mode !== "maximize") return m;
    let targets: Map<EmblemColor, number> | undefined;
    if (colorMode !== "off" && activeColors.size > 0) {
      targets = new Map<EmblemColor, number>();
      for (const col of activeColors) {
        const n = colorCounts[col] ?? 0;
        if (n > 0) targets.set(col, n);
      }
    }
    // Include active protect floors so zero-weight stats (e.g. moveSpeed on
    // Attackers) still show a flat estimate beside the slider.
    const alsoReport = (Object.entries(floorActive) as [keyof StatBlock, boolean][])
      .filter(([, active]) => active)
      .map(([stat]) => stat);
    for (const p of predictFlatStatRanges(pool, priorities, 20, targets, alsoReport)) {
      m.set(p.stat, p);
    }
    return m;
  }, [mode, pool, priorities, colorMode, activeColors, colorCounts, floorActive]);

  const pokemonContext = useMemo((): PokemonScoringContext | undefined => {
    if (!pokemon || !pokemonAwareScoring) return undefined;
    const baseStats = pokemon.baseStatsByLevel[optimizeLevel - 1];
    if (!baseStats) return undefined;
    return { pokemonId: pokemon.id, level: optimizeLevel, baseStats };
  }, [pokemon, optimizeLevel, pokemonAwareScoring]);

  // Hard color constraints (only active in "exact" mode)
  const colorConstraints: Map<EmblemColor, number> | null = useMemo(() => {
    if (colorMode !== "exact" || activeColors.size === 0) return null;
    const m = new Map<EmblemColor, number>();
    for (const col of activeColors) m.set(col, colorCounts[col] ?? 0);
    return m;
  }, [colorMode, activeColors, colorCounts]);

  const totalColorConstrained = useMemo(
    () => [...(colorConstraints?.values() ?? [])].reduce((a, b) => a + b, 0),
    [colorConstraints],
  );

  // Per-color capacity: how many distinct Pokémon in the current pool carry each color.
  // A dual-color emblem contributes to BOTH colors, so the sum can reach up to 2×SLOTS=20.
  const colorCapacities = useMemo(() => colorGroupSizes(pool), [pool]);

  // Exact-mode validity: each per-color count ≤ pool capacity AND total ≤ 2×SLOTS.
  const colorConstraintValid = useMemo(() => {
    if (!colorConstraints) return true;
    if (totalColorConstrained > 2 * SLOTS) return false;
    for (const [col, need] of colorConstraints) {
      const cap = Math.min(SLOTS, colorCapacities.get(col) ?? 0);
      if (need > cap) return false;
    }
    return true;
  }, [colorConstraints, totalColorConstrained, colorCapacities]);

  // Constrained build count (DP): narrows the search-space display when exact
  // constraints are set. null = too many to count; 0n = infeasible.
  const constrainedBuildCount = useMemo(() => {
    if (!colorConstraints || !colorConstraintValid) return null;
    return countConstrainedBuilds(pool, colorConstraints, SLOTS);
  }, [pool, colorConstraints, colorConstraintValid]);

  // Whether the orchestrator will run exact enumeration for the current config.
  // Uses the exported shouldRunExact helper from the orchestrator — same function
  // the search uses — so the indicator cannot silently diverge from real behavior.
  // Gate: constrainedCount ≤ exactCap (no pool-size limit; k-vector enumeration
  // is bounded by the constrained count, not by the total number of Pokémon).
  const willRunExact = useMemo(() => {
    if (colorMode !== "exact" || !colorConstraints || !colorConstraintValid) return false;
    return shouldRunExact(constrainedBuildCount, exactCap);
  }, [colorMode, colorConstraints, colorConstraintValid, constrainedBuildCount, exactCap]);

  const searchWillRunExact = expert ? willRunExact : basicWillRunExactSearch;
  const effectiveResultCount = searchWillRunExact ? 1 : resultCount;

  // Proposed color set-bonus preview — shown in the Color card regardless of
  // exact/weighted mode. Derived from the active color counts entered by the
  // user, not from colorConstraints (which is only set in exact mode).
  const colorBonusPreviews = useMemo<ColorBonusPreviewItem[]>(() => {
    if (colorMode === "off" || activeColors.size === 0) return [];
    const counts = new Map<EmblemColor, number>();
    for (const col of activeColors) {
      const n = colorCounts[col] ?? 0;
      if (n > 0) counts.set(col, n);
    }
    return proposedColorBonuses(counts, setBonuses);
  }, [colorMode, activeColors, colorCounts, setBonuses]);

  // ---- Search options (per mode) ----
  const advancedSearchOptions: SearchOptions = useMemo(() => ({
    mode,
    priorities: mode === "maximize" ? priorities : {},
    targets: Object.fromEntries(
      Object.entries(targetValues)
        .filter(([k]) => targetActive[k])
        .map(([k, v]) => [k, parseFloat(v) || 0]),
    ),
    targetActive,
    protected: Object.fromEntries(
      Object.entries(floorValues)
        .filter(([k]) => floorActive[k])
        .map(([k, v]) => [k, parseFloat(v) || 0]),
    ),
    colorConstraints,
    // Weighted mode forces colorBonuses=true (soft steering via incentive scoring).
    // Exact mode and Off mode use the standalone colorBonuses checkbox.
    colorBonuses: colorMode === "weighted" ? true : colorBonuses,
    scoringMode: pokemonAwareScoring && pokemon ? "pokemon" : "classic",
    pokemonContext,
    slots: SLOTS,
    exactCap,
  }), [mode, priorities, targetValues, targetActive, floorValues, floorActive, colorConstraints, colorMode, colorBonuses, pokemonAwareScoring, pokemon, pokemonContext, exactCap]);

  // ---- Search engine ----
  const { state: searchState, run, cancel, clearResult, goHistory } = useEmblemSearch();

  const searchSettingsKey = useMemo(
    () => buildSearchSettingsKey({
      pokemonId: loadout.pokemonId,
      optimizeLevel,
      basicUseOwned,
      useOwned,
      mixedGrades,
      allowedGrades: [...allowedGrades].sort(),
      basicEffort: resolvedBasicEffort,
      effort,
      colorBonuses,
      pokemonAwareScoring,
      exactCap,
      mode,
      customWeights,
      targetValues,
      targetActive,
      floorValues,
      floorActive,
      colorMode,
      activeColors: [...activeColors].sort(),
      colorCounts,
      ownedKeys: [...owned].sort(),
      resultCount,
    }),
    [
      loadout.pokemonId,
      optimizeLevel,
      basicUseOwned,
      useOwned,
      mixedGrades,
      allowedGrades,
      resolvedBasicEffort,
      effort,
      colorBonuses,
      pokemonAwareScoring,
      exactCap,
      mode,
      customWeights,
      targetValues,
      targetActive,
      floorValues,
      floorActive,
      colorMode,
      activeColors,
      colorCounts,
      owned,
      resultCount,
    ],
  );

  // Changing the selected Pokémon clears result history. Other setting edits
  // keep the stack visible so prior builds remain browsable and applyable.
  const prevPokemonIdRef = useRef(loadout.pokemonId);
  useEffect(() => {
    if (searchState.status === "running") return;
    if (prevPokemonIdRef.current !== loadout.pokemonId) {
      prevPokemonIdRef.current = loadout.pokemonId;
      clearResult();
    }
  }, [loadout.pokemonId, searchState.status, clearResult]);

  const resultPicks = useMemo(
    () => emblemPicksFromResult(searchState.result),
    [searchState.result],
  );

  // ---- Apply feedback (inline, since the Builder isn't visible here) ----
  // `applied` tracks what's been pushed to the loadout for the *current* result;
  // it resets whenever a fresh result arrives. `toast` is a transient banner.
  const [applied, setApplied] = useState<AppliedState>({ emblems: false });
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  }, []);

  // Reset applied state when the viewed generation changes.
  useEffect(() => {
    setApplied({ emblems: false });
  }, [searchState.result, searchState.historyIndex]);

  // Clear any pending toast timer on unmount.
  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  const applyEmblemsToLoadout = useCallback((emblems: EmblemPick[]) => {
    if (!emblems.length) return;
    dispatch({ type: "applyBuild", emblems });
    setApplied({ emblems: true });
    showToast(`Applied ${emblems.length} emblem${emblems.length !== 1 ? "s" : ""} to your loadout.`);
  }, [dispatch, showToast]);

  const handleApplyEmblems = useCallback(() => {
    applyEmblemsToLoadout(resultPicks ?? []);
  }, [applyEmblemsToLoadout, resultPicks]);

  const applyAdvancedColorDefaults = useCallback((targetPool: typeof pool) => {
    const defaults = deriveAdvancedColorUiDefaults(pokemon, targetPool, allEmblems);
    setColorMode(defaults.colorMode);
    setActiveColors(new Set(defaults.activeColors));
    setColorCounts(
      Object.fromEntries(POSITIVE_COLORS.map((c) => [c, defaults.colorCounts.get(c) ?? 0])) as Record<EmblemColor, number>,
    );
  }, [pokemon, allEmblems]);

  const applyAdvancedProtectDefaults = useCallback((level: number) => {
    if (pokemon) {
      // Preset floors (merged with mobility/defense guards) when a preset exists,
      // else the population-relative generic floors — keeps Advanced ↔ Basic aligned.
      const resolved = resolveEmblemPreset(pokemon);
      const floors = resolved
        ? presetProtectFloors(pokemon, resolved.preset)
        : deriveProtectFloors(pokemon, pokemonList, level);
      const newFloorActive: Record<string, boolean> = {};
      const newFloorValues: Record<string, string> = {};
      for (const stat of Object.keys(floors)) {
        newFloorActive[stat] = true;
        newFloorValues[stat] = String((floors as Record<string, number>)[stat] ?? 0);
      }
      setFloorActive(newFloorActive);
      setFloorValues(newFloorValues);
    } else {
      setFloorActive({});
      setFloorValues({});
    }
  }, [pokemon]);

  // Pokémon-specific Advanced defaults without resetting pool/effort customizations.
  const syncAdvancedFromPokemon = useCallback(() => {
    setCustomWeights({});
    applyAdvancedProtectDefaults(optimizeLevel);
    applyAdvancedColorDefaults(pool);
  }, [optimizeLevel, pool, applyAdvancedProtectDefaults, applyAdvancedColorDefaults]);

  // Sync Expert controls from Beginner defaults (called when switching Basic→Advanced
  // via the global mode toggle, the "switch to Advanced" links, or ↺ Reset).
  // Expert defaults: owned inventory pool + exact meta colors + protect defaults.
  const syncAdvancedFromBasic = useCallback(() => {
    const grades = new Set(DEFAULT_ALLOWED_GRADES);
    setUseOwned(BASIC_POOL_DEFAULTS.useOwned);
    setMixedGrades(true);
    setAllowedGrades(grades);
    setMode("maximize");
    setColorBonuses(true);
    setPokemonAwareScoring(true);
    setCustomWeights({});
    setExactCap(DEFAULT_EXACT_CAP);

    applyAdvancedProtectDefaults(optimizeLevel);

    const defaultPool = buildPool(
      allEmblems,
      { useOwned: BASIC_POOL_DEFAULTS.useOwned, mixedGrades: true, allowedGrades: grades },
      owned,
    );
    applyAdvancedColorDefaults(defaultPool);
  }, [optimizeLevel, allEmblems, owned, applyAdvancedProtectDefaults, applyAdvancedColorDefaults]);

  // Sync Advanced defaults when entering Advanced or when the Pokémon changes in Advanced.
  // prevExpert starts false so a page that loads already in Advanced mode is treated as
  // "just entered" on first mount and populates defaults for the already-selected Pokémon.
  // Safe because OptimizeScreen stays mounted (hidden) across tab switches — no remount —
  // and the optimizer's settings are not persisted, so there is nothing to clobber.
  const prevExpert = useRef(false);
  const prevPokemonIdForExpert = useRef(loadout.pokemonId);
  useEffect(() => {
    const expertJustEnabled = expert && !prevExpert.current;
    prevExpert.current = expert;

    if (!expert || !pokemon) {
      prevPokemonIdForExpert.current = loadout.pokemonId;
      return;
    }

    if (expertJustEnabled) {
      syncAdvancedFromBasic();
      prevPokemonIdForExpert.current = loadout.pokemonId;
      return;
    }

    const pokemonChanged = prevPokemonIdForExpert.current !== loadout.pokemonId;
    prevPokemonIdForExpert.current = loadout.pokemonId;
    if (pokemonChanged) syncAdvancedFromPokemon();
  }, [expert, loadout.pokemonId, pokemon, syncAdvancedFromBasic, syncAdvancedFromPokemon]);

  // Beginner search — builds the Expert-equivalent SearchOptions. Meta color
  // targets are enforced as hard constraints whenever feasible on the ACTUAL
  // Beginner pool (Concept A: automatic, on any effort). Exhaustive exact
  // enumeration runs only when the user picked the "Exact" quality and it is
  // feasible (Concept B); otherwise exactCap=0 keeps the hard constraints but
  // runs the heuristic at the chosen effort. Feasibility is judged on basicPool
  // (owned or full per the Beginner toggle), never the Expert full pool.
  const handleBasicSearch = useCallback(async () => {
    if (!pokemon || !basicObjective || basicPool.length < SLOTS) return;
    const { forceHeuristic, heuristicEffort, exactCap: basicExactCap } = resolveBasicSearchParams(
      basicEffort,
      basicColorResolution,
    );
    const { options } = buildPresetSearchOptions({
      pokemon,
      level: optimizeLevel,
      pool: basicPool,
      emblems: allEmblems,
      pokemonList,
      forceHeuristic,
      exactCap: basicExactCap,
    });
    await run(
      basicPool,
      options,
      setBonuses,
      heuristicEffort as Effort,
      searchSettingsKey,
      effectiveResultCount,
    );
  }, [
    pokemon,
    basicObjective,
    basicPool,
    basicColorResolution,
    optimizeLevel,
    basicEffort,
    run,
    searchSettingsKey,
    effectiveResultCount,
  ]);

  // Expert search (Expert tab only — pool source toggle applies here, not in Beginner)
  const handleAdvancedSearch = useCallback(async () => {
    if (advancedNotEnoughEmblems) return;
    await run(pool, advancedSearchOptions, setBonuses, effort, searchSettingsKey, effectiveResultCount);
  }, [advancedNotEnoughEmblems, pool, advancedSearchOptions, effort, run, searchSettingsKey, effectiveResultCount]);

  const hasResult = (searchState.status === "done" || searchState.status === "cancelled")
    && !!resultPicks?.length;

  const historyCount = searchState.history.length;
  const historyIndex = searchState.historyIndex >= 0 ? searchState.historyIndex : 0;

  // ---- Effective stat delta ----
  const effectiveDelta = useMemo((): EffectiveDelta | null => {
    const result = searchState.result;
    if (!result || !pokemon) return null;

    const items: HeldItem[] = [];
    const itemGrades: number[] = [];
    for (let i = 0; i < 3; i++) {
      const id = loadout.heldItemIds[i];
      if (!id) continue;
      const item = heldItemById.get(id);
      if (!item) continue;
      items.push(item);
      itemGrades.push(heldSlotGrades[i] ?? 40);
    }

    try {
      const ctx = { inCombat: true, goalsScored: 0 };
      const emptyLoadout = computeEmblemLoadout([], setBonuses);
      const emblemLoadout = computeEmblemLoadout(result.picks, setBonuses);
      const baseline = computeEffectiveStats(pokemon, optimizeLevel, emptyLoadout, items, itemGrades, ctx);
      const withEmblems = computeEffectiveStats(pokemon, optimizeLevel, emblemLoadout, items, itemGrades, ctx);

      const delta: Partial<Record<keyof StatBlock, number>> = {};
      for (const key of Object.keys(baseline) as (keyof StatBlock)[]) {
        const d = (withEmblems[key] ?? 0) - (baseline[key] ?? 0);
        if (Math.abs(d) > 0.005) delta[key] = d;
      }

      return { delta };
    } catch {
      return null;
    }
  }, [searchState.result, pokemon, optimizeLevel, loadout.heldItemIds, heldSlotGrades]);

  // ---- Render ----
  return (
    <div className="flex flex-col gap-3">

      {/* ================================================================== */}
      {/* BASIC MODE (global Basic/Advanced toggle)                           */}
      {/* ================================================================== */}
      {!expert && (
        <>
          {!pokemon && (
            <div className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-muted shadow-sm">
              Tap the Pokémon icon at the top to choose who to optimize.
            </div>
          )}

          {/* Not enough emblems in pool */}
          {pokemon && basicNotEnoughEmblems && basicUseOwned && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
              <p className="font-medium text-amber-700 dark:text-amber-300">
                You own only {basicPool.length} emblem{basicPool.length !== 1 ? "s" : ""} — need {SLOTS} for a full build.
              </p>
              <p className="mt-1 text-xs text-muted">
                Mark more emblems as owned on the{" "}
                <button
                  onClick={() => onNavigate?.("emblems")}
                  className="font-medium text-accent-ink underline"
                >
                  ★ Emblems
                </button>{" "}
                page, or{" "}
                <button
                  onClick={() => setBasicUseOwned(false)}
                  className="font-medium text-accent-ink underline"
                >
                  switch to the full dataset
                </button>
                .
              </p>
            </div>
          )}
          {pokemon && basicNotEnoughEmblems && !basicUseOwned && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
              <p className="font-medium text-amber-700 dark:text-amber-300">
                Only {basicPool.length} emblem candidate{basicPool.length !== 1 ? "s" : ""} in pool — need {SLOTS} for a full build.
              </p>
              <p className="mt-1 text-xs text-muted">
                Enable more grades above, or{" "}
                <button
                  onClick={() => setViewMode("expert")}
                  className="font-medium text-accent-ink underline"
                >
                  switch to Advanced
                </button>{" "}
                for finer pool control.
              </p>
            </div>
          )}

          {/* Settings — level, emblem pool, and search quality */}
          {pokemon && (
            <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface px-4 py-3 shadow-sm">
              {/* Level */}
              <div className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2">
                <span className="shrink-0 text-xs text-muted">Optimize for level</span>
                <input
                  type="range"
                  min={1} max={15} step={1}
                  value={optimizeLevel}
                  onChange={(e) => setOptimizeLevel(parseInt(e.target.value))}
                  className="flex-1 accent-accent"
                />
                <span className="w-6 shrink-0 text-right font-mono text-sm font-semibold text-ink">
                  {optimizeLevel}
                </span>
              </div>

              {/* Emblem pool */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-muted">Emblems to use</span>
                <Segmented<"owned" | "all">
                  fluid
                  value={basicUseOwned ? "owned" : "all"}
                  options={["owned", "all"]}
                  labels={{ owned: "My emblems", all: "All emblems" }}
                  onChange={(v) => setBasicUseOwned(v === "owned")}
                />
                {!basicUseOwned && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted">Grades:</span>
                    {(["gold", "silver", "bronze"] as EmblemGrade[]).map((g) => {
                      const on = allowedGrades.has(g);
                      return (
                        <button
                          key={g}
                          type="button"
                          onClick={() => {
                            const next = new Set(allowedGrades);
                            on ? next.delete(g) : next.add(g);
                            if (next.size > 0) setAllowedGrades(next);
                          }}
                          className={`rounded-full px-3 py-1 font-medium capitalize transition ${
                            on
                              ? "bg-accent text-white"
                              : "bg-raise text-muted hover:text-ink"
                          }`}
                        >
                          {g}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Search quality — orthogonal to color matching. The Exact option
                  (exhaustive enumeration) is offered only when feasible. */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-muted">Search quality</span>
                <Segmented<BasicEffort>
                  fluid
                  value={resolvedBasicEffort}
                  options={
                    basicExactEnumFeasible
                      ? (["quick", "normal", "thorough", "exact"] as BasicEffort[])
                      : (["quick", "normal", "thorough"] as BasicEffort[])
                  }
                  labels={{ quick: "Fast", normal: "Balanced", thorough: "Thorough", exact: "Exact" }}
                  onChange={setBasicEffort}
                />
                <p className="text-xs text-muted">
                  {!basicExactColorFeasible
                    ? "This pool can't hit the exact meta emblem colors, so emblem colors are steered toward the meta. Quality controls how hard the search works."
                    : basicWillRunExactSearch
                      ? "Exact emblem colors are matched automatically, and Exact runs an exhaustive search for the guaranteed-best build."
                      : basicExactEnumFeasible
                        ? "Exact emblem colors are matched automatically at any quality. Pick Exact for an exhaustive search, or Fast/Balanced/Thorough for quicker results."
                        : "Exact emblem colors are matched automatically at any quality. This pool is too large for an exhaustive search, so just pick how hard the search works."}
                </p>
              </div>

              <VariationsControl
                value={resultCount}
                onChange={setResultCount}
                disabled={searchWillRunExact}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleBasicSearch}
              disabled={!pokemon || basicNotEnoughEmblems || searchState.status === "running"}
              className="rounded-xl bg-accent px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-accent/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {searchState.status === "running" ? "Searching…" : "Find Build"}
            </button>
            {searchState.status === "done" && searchState.result && (
              <span className="text-xs text-muted">
                Done in {(searchState.result.totalMs / 1000).toFixed(1)}s
              </span>
            )}
            {searchState.status === "error" && (
              <span className="text-xs text-neg">{searchState.errorMsg}</span>
            )}
          </div>

          {/* Results */}
          {hasResult && resultPicks && (
            <ResultCards
              picks={resultPicks}
              effectiveDelta={effectiveDelta}
              searchResult={searchState.result}
              pokemon={pokemon}
              optimizeLevel={optimizeLevel}
              pokemonAwareScoring
              applied={applied}
              historyCount={historyCount}
              historyIndex={historyIndex}
              onGoHistory={goHistory}
              onApplyEmblems={handleApplyEmblems}
            />
          )}

          {searchState.status === "done" && !searchState.result && (
            <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-faint">
              No valid loadout found. Try{" "}
              {basicUseOwned ? (
                <>
                  <button
                    onClick={() => onNavigate?.("emblems")}
                    className="font-medium text-accent-ink underline"
                  >
                    marking more emblems
                  </button>{" "}
                  as owned, or{" "}
                  <button
                    onClick={() => setBasicUseOwned(false)}
                    className="font-medium text-accent-ink underline"
                  >
                    using the full dataset
                  </button>
                </>
              ) : (
                <>
                  enabling more grades or{" "}
                  <button
                    onClick={() => setViewMode("expert")}
                    className="font-medium text-accent-ink underline"
                  >
                    switching to Advanced
                  </button>
                </>
              )}
              .
            </p>
          )}
        </>
      )}

      {/* ================================================================== */}
      {/* ADVANCED MODE (global Basic/Advanced toggle)                        */}
      {/* ================================================================== */}
      {expert && (
        <>
          {/* Pokémon identity lives in the always-visible app bar; the reset
              action sits next to the Search button below for an easy tap target. */}
          {!pokemon && (
            <div className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-muted shadow-sm">
              Tap the Pokémon icon at the top to choose who to optimize.
            </div>
          )}

          {/* Not enough emblems in pool */}
          {pokemon && advancedNotEnoughEmblems && useOwned && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
              <p className="font-medium text-amber-700 dark:text-amber-300">
                You own only {pool.length} emblem{pool.length !== 1 ? "s" : ""} — need {SLOTS} for a full build.
              </p>
              <p className="mt-1 text-xs text-muted">
                Mark more emblems as owned on the{" "}
                <button
                  onClick={() => onNavigate?.("emblems")}
                  className="font-medium text-accent-ink underline"
                >
                  ★ Emblems
                </button>{" "}
                page, or{" "}
                <button
                  onClick={() => setUseOwned(false)}
                  className="font-medium text-accent-ink underline"
                >
                  switch to the full dataset
                </button>
                .
              </p>
            </div>
          )}
          {pokemon && advancedNotEnoughEmblems && !useOwned && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
              <p className="font-medium text-amber-700 dark:text-amber-300">
                Only {pool.length} emblem candidate{pool.length !== 1 ? "s" : ""} in pool — need {SLOTS} for a full build.
              </p>
              <p className="mt-1 text-xs text-muted">
                Enable more grades above.
              </p>
            </div>
          )}

          {/* Pool section */}
          <CollapsibleCard
            title="Search Pool"
            persistKey="optimizer-pool"
            right={
              <span className="text-xs text-faint">
                {pool.length} emblems · {new Set(pool.map((c) => c.pokemonName)).size} Pokémon
              </span>
            }
          >
            <div className="flex flex-col gap-3">
              <Segmented<"owned" | "all">
                fluid
                value={useOwned ? "owned" : "all"}
                options={["owned", "all"]}
                labels={{ owned: "Owned only", all: "Full dataset" }}
                onChange={(v) => setUseOwned(v === "owned")}
              />
              {useOwned && (
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={mixedGrades}
                    onChange={(e) => setMixedGrades(e.target.checked)}
                    className="accent-accent"
                  />
                  <span>
                    Mixed grades{" "}
                    <span className="text-xs text-faint">
                      — Bronze, Silver, and Gold can differ across the 10 slots (recommended)
                    </span>
                  </span>
                </label>
              )}
              {!useOwned && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted">Grades:</span>
                  {(["gold", "silver", "bronze"] as EmblemGrade[]).map((g) => {
                    const on = allowedGrades.has(g);
                    return (
                      <button
                        key={g}
                        type="button"
                        onClick={() => {
                          const next = new Set(allowedGrades);
                          on ? next.delete(g) : next.add(g);
                          if (next.size > 0) setAllowedGrades(next);
                        }}
                        className={`rounded-full px-3 py-1 font-medium capitalize transition ${
                          on ? "bg-accent text-white" : "bg-raise text-muted hover:text-ink"
                        }`}
                      >
                        {g}
                      </button>
                    );
                  })}
                </div>
              )}
              {/* Search-space summary — label/value rows so each wraps as a unit
                  on mobile instead of breaking mid-phrase. */}
              {(() => {
                const colorExact = colorMode === "exact" && colorConstraints && colorConstraintValid;
                const matchesZero = colorExact && constrainedBuildCount === 0n;
                return (
                  <div className="flex flex-col gap-2 rounded-lg bg-white/10 px-3 py-2.5 text-xs">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="shrink-0 text-muted">{colorExact ? "Matching builds" : "Possible builds"}</span>
                      <span className={`min-w-0 text-right font-mono font-semibold ${matchesZero ? "text-neg" : "text-ink"}`}>
                        {colorExact
                          ? constrainedBuildCount === null
                            ? "many"
                            : constrainedBuildCount === 0n
                              ? "none match"
                              : <>{formatBuildCount(constrainedBuildCount)} <span className="font-sans font-normal text-faint">of {formatBuildCount(buildCount)}</span></>
                          : formatBuildCount(buildCount)}
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between gap-3">
                      <span className="shrink-0 text-muted">Emblem pool</span>
                      <span className="min-w-0 text-right text-faint">
                        {candidateCount.toLocaleString()} emblems · {poolDistinctNames} Pokémon
                      </span>
                    </div>

                    {colorExact && constrainedBuildCount !== null && constrainedBuildCount > 0n && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="shrink-0 text-muted">Method</span>
                        <span
                          className={`shrink-0 rounded-full bg-raise px-2 py-0.5 text-xs font-semibold ${
                            willRunExact ? "text-pos" : "text-accent-ink"
                          }`}
                          title={
                            willRunExact
                              ? `Checks all ${formatBuildCount(constrainedBuildCount)} matching builds — guaranteed best`
                              : `${formatBuildCount(constrainedBuildCount)} builds exceeds the cap — smart search finds a strong result`
                          }
                        >
                          {willRunExact ? "⚡ Exact" : "Smart search"}
                        </span>
                      </div>
                    )}

                    {matchesZero && (
                      <p className="text-xs text-neg">
                        No builds match these exact color counts — adjust targets below or expand the pool.
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          </CollapsibleCard>

          {/* Mode & Effort */}
          <CollapsibleCard title="Mode & Effort" persistKey="optimizer-mode">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted">Objective</span>
                <Segmented<SearchMode>
                  fluid
                  value={mode}
                  options={["maximize", "target"]}
                  labels={{ maximize: "Maximize", target: "Target" }}
                  onChange={setMode}
                />
                <p className="text-xs text-muted">
                  {mode === "maximize"
                    ? "Score builds by your priority stats. Adjust weights in Stat Priorities below."
                    : "Find a build close to the flat stat totals you set in Stat Targets below."}
                </p>
              </div>

              {/* Exact search cap — only relevant when color mode is "exact" */}
              {colorMode === "exact" && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted" htmlFor="adv-exact-cap">
                    Max builds before switching to smart search
                  </label>
                  {exactCap !== DEFAULT_EXACT_CAP && (
                    <button
                      onClick={() => setExactCap(DEFAULT_EXACT_CAP)}
                      className="text-xs text-faint underline hover:text-muted"
                    >
                      reset to 1B
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="adv-exact-cap"
                    type="number"
                    min={1}
                    step={1}
                    value={exactCap}
                    onChange={(e) => {
                      // valueAsNumber is NaN when the field is empty/invalid;
                      // only commit a clean integer ≥ 1 to avoid snapping to 1
                      // mid-edit when the user clears the field to retype.
                      const n = e.target.valueAsNumber;
                      if (Number.isFinite(n) && n >= 1) {
                        setExactCap(Math.floor(n));
                      }
                    }}
                    className="w-40 rounded bg-surface px-2 py-1 font-mono text-xs text-ink ring-1 ring-line focus:outline-none focus:ring-accent"
                  />
                  <span className="text-xs text-faint">
                    {exactCap.toLocaleString()} — {colorMode === "exact" && willRunExact ? "exact" : colorMode === "exact" ? "smart search" : ""}
                  </span>
                </div>
                <p className="text-xs text-faint">
                  Below this cap, every valid build is checked (guaranteed best). Above it,
                  smart search still finds a strong result. Default: {DEFAULT_EXACT_CAP.toLocaleString()}.
                </p>
              </div>
              )}

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted">Smart search effort</span>
                <Segmented<Effort>
                  fluid
                  value={effort}
                  options={["quick", "normal", "thorough"]}
                  labels={{ quick: "Quick", normal: "Normal", thorough: "Thorough" }}
                  onChange={setEffort}
                />
                <p className="text-xs text-faint">
                  {effort === "quick"
                    ? "Smart search · quick pass (~2s). Not exact — finds a strong build heuristically."
                    : effort === "thorough"
                      ? "Smart search · longer pass (~25s). Not exact — finds a strong build heuristically."
                      : "Smart search · default balance (~8s). Not exact — finds a strong build heuristically."}
                </p>
              </div>

              <VariationsControl
                value={resultCount}
                onChange={setResultCount}
                disabled={searchWillRunExact}
              />

              {/* Level control */}
              <div className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2">
                <span className="shrink-0 text-xs text-muted">Optimize for level</span>
                <input
                  type="range" min={1} max={15} step={1}
                  value={optimizeLevel}
                  onChange={(e) => setOptimizeLevel(parseInt(e.target.value))}
                  className="flex-1 accent-accent"
                />
                <span className="w-6 shrink-0 text-right font-mono text-sm font-semibold text-ink">
                  {optimizeLevel}
                </span>
              </div>

              {mode === "maximize" && (
                <div className="flex flex-col gap-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={colorBonuses}
                      onChange={(e) => setColorBonuses(e.target.checked)}
                      className="accent-accent"
                    />
                    <span>Include color set-bonus scoring</span>
                  </label>
                  <label className={`flex cursor-pointer items-center gap-2 text-sm ${!pokemon ? "opacity-50" : ""}`}>
                    <input
                      type="checkbox"
                      checked={pokemonAwareScoring && !!pokemon}
                      onChange={(e) => setPokemonAwareScoring(e.target.checked)}
                      disabled={!pokemon}
                      className="accent-accent"
                    />
                    <span>
                      Pokémon-aware scoring
                      {pokemon
                        ? ` — ${pokemon.displayName} Lv.${optimizeLevel}`
                        : " (select a Pokémon)"}
                    </span>
                  </label>
                </div>
              )}
            </div>
          </CollapsibleCard>

          {/* Color mode */}
          <CollapsibleCard title="Color" persistKey="optimizer-colors" defaultOpen={false}>
            <div className="flex flex-col gap-3">
              {/* Mode selector */}
              <div className="flex flex-col gap-1">
                <span className="text-xs text-faint">Color mode</span>
                <Segmented<ColorMode>
                  fluid
                  value={colorMode}
                  options={["off", "weighted", "exact"]}
                  onChange={setColorMode}
                  labels={{ off: "Off", weighted: "Weighted", exact: "Exact" }}
                />
              </div>

              {/* Weighted mode description */}
              {colorMode === "weighted" && (
                <p className="text-xs text-muted">
                  Steers the search toward higher set-bonus tiers without rejecting builds.
                  Set-bonus scoring is always on in this mode. Use <strong>Exact</strong> to
                  require specific per-color counts.
                </p>
              )}

              {/* Count inputs — shown in both Exact and Weighted (preview in Weighted) */}
              {colorMode !== "off" && (
                <>
                  {pokemon && (
                    <p className="text-xs text-faint">
                      {presetAutofillIntro(pokemon.displayName, emblemPresetResolution)} when you reset or change Pokémon.
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {POSITIVE_COLORS.map((col) => (
                      <label
                        key={col}
                        className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border bg-white/5 p-2 text-xs transition ${
                          activeColors.has(col) ? "border-accent/60 bg-accent-weak" : "border-line"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={activeColors.has(col)}
                          onChange={(e) => {
                            const next = new Set(activeColors);
                            e.target.checked ? next.add(col) : next.delete(col);
                            setActiveColors(next);
                          }}
                          className="accent-accent"
                        />
                        <ColorDot color={col} />
                        <span className="flex-1 capitalize">{col}</span>
                        {/* Always reserve the count field's space so chips keep a
                            consistent size whether or not the color is selected. */}
                        <div className={`shrink-0 ${activeColors.has(col) ? "" : "invisible"}`} aria-hidden={!activeColors.has(col)}>
                          <ColorCountField
                            label={col}
                            value={colorCounts[col] ?? 0}
                            max={Math.min(SLOTS, colorCapacities.get(col) ?? SLOTS)}
                            onCommit={(n) => setColorCounts((prev) => ({ ...prev, [col]: n }))}
                          />
                        </div>
                      </label>
                    ))}
                  </div>

                  {/* Exact-mode validation messages */}
                  {colorMode === "exact" && !colorConstraintValid && (
                    <p className="text-xs text-neg">
                      {totalColorConstrained > 2 * SLOTS
                        ? `Color-point sum ${totalColorConstrained} exceeds ${2 * SLOTS} (max for ${SLOTS} dual-color emblems).`
                        : "A color count exceeds what the pool can provide — lower it or expand the pool."}
                    </p>
                  )}
                  {colorMode === "exact" && colorConstraintValid && totalColorConstrained > 0 && (
                    <p className="text-xs text-muted">
                      {totalColorConstrained} color-point{totalColorConstrained !== 1 ? "s" : ""} across{" "}
                      {activeColors.size} color{activeColors.size !== 1 ? "s" : ""}.
                      {totalColorConstrained > SLOTS && " (sum > 10 is valid — dual-color emblems count toward both colors)"}
                    </p>
                  )}
                  {/* Weighted-mode preview note */}
                  {colorMode === "weighted" && activeColors.size > 0 && (
                    <p className="text-xs text-faint">
                      Counts are for reference — scoring uses set-bonus incentive, not hard constraints.
                    </p>
                  )}

                  {/* ── Proposed bonus preview (both modes) ─────────────── */}
                  {colorBonusPreviews.length > 0 && (
                    <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-white/5 p-2">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-faint">
                        Set bonus preview
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {colorBonusPreviews.map((b) => {
                          const pctStr = `+${(b.percent * 100).toFixed(0)}%`;
                          const statLabel = BONUS_STAT_LABELS[b.stat] ?? String(b.stat);
                          // Concrete delta on the selected Pokémon's base stats
                          const baseStats = pokemon?.baseStatsByLevel?.[optimizeLevel - 1];
                          const baseVal = baseStats?.[b.stat] ?? 0;
                          const delta = baseVal > 0 ? concreteBonusDelta(b, baseVal) : null;
                          const deltaStr =
                            delta !== null
                              ? b.percentPoint
                                ? ` (+${(delta * 100).toFixed(1)}%)`
                                : ` (Approx. +${Math.floor(delta)})`
                              : null;
                          return (
                            <span
                              key={b.color}
                              title={`${b.color} ×${b.count} → Tier ${b.tier}`}
                              className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-ink"
                            >
                              <ColorDot color={b.color} />
                              <span className="capitalize">{b.color}</span>
                              <span className="text-faint">×{b.count}</span>
                              <span className="font-medium text-pos">
                                {pctStr} {statLabel}
                              </span>
                              {deltaStr && (
                                <span className="text-muted">{deltaStr}</span>
                              )}
                            </span>
                          );
                        })}
                      </div>
                      {pokemon && (
                        <span className="text-xs text-faint">
                          Based on {pokemon.displayName} at level {optimizeLevel}.
                        </span>
                      )}
                    </div>
                  )}
                  {activeColors.size > 0 && colorBonusPreviews.length === 0 && (
                    <p className="text-xs text-faint">
                      No set-bonus tier reached at these counts.
                    </p>
                  )}

                  {/* ── Affected pool size ───────────────────────────────── */}
                  {colorMode === "exact" && colorConstraintValid && (
                    <div className="text-xs text-muted">
                      {constrainedBuildCount === null
                        ? "Matching builds: too many to count."
                        : constrainedBuildCount === 0n
                        ? <span className="text-neg">Matching builds: 0 — no combination hits these exact counts.</span>
                        : <>
                            Matching builds:{" "}
                            <span className="font-medium text-ink">
                              {formatBuildCount(constrainedBuildCount)}
                            </span>{" "}
                            {willRunExact
                              ? <span className="text-pos">· exact search</span>
                              : <span className="text-muted">· smart search (above cap)</span>}
                          </>
                      }
                    </div>
                  )}
                  {colorMode === "weighted" && activeColors.size > 0 && (
                    <div className="text-xs text-muted">
                      Pool size:{" "}
                      <span className="font-medium text-ink">{formatBuildCount(buildCount)}</span>{" "}
                      builds — colors affect scoring, not which builds are allowed.
                    </div>
                  )}
                </>
              )}
            </div>
          </CollapsibleCard>

          {/* Stat Priorities (Maximize) */}
          {mode === "maximize" && (
            <CollapsibleCard title="Stat Priorities" persistKey="optimizer-priorities">
              <div className="flex flex-col gap-2">
                <p className="text-xs text-faint">
                  {pokemon
                    ? `${presetAutofillIntro(pokemon.displayName, emblemPresetResolution)}. Adjust sliders to reprioritize — predicted flat stats update below each one.`
                    : "Select a Pokémon to auto-populate weights."}
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {Object.entries(STAT_LABELS).map(([stat, label]) => {
                    const w = priorities[stat as keyof typeof priorities] ?? 0;
                    const uiValue = Math.min(1, w / WEIGHT_UI_MAX);
                    const pred = flatStatPredictionByStat.get(stat as keyof StatBlock);
                    return (
                      <div key={stat} className={`${STAT_ROW_GRID} text-xs`}>
                        <span className="text-muted">{label}</span>
                        <input
                          type="range" min={0} max={1} step={0.1}
                          value={uiValue}
                          onChange={(e) =>
                            setCustomWeights((prev) => ({
                              ...prev,
                              [stat]: parseFloat(e.target.value) * WEIGHT_UI_MAX,
                            }))
                          }
                          className="col-start-2 min-w-0 accent-accent"
                        />
                        <span className="col-start-3 text-right font-mono text-ink tabular-nums">
                          {uiValue.toFixed(1)}
                        </span>
                        <div className="col-start-2 row-start-2 leading-tight">
                          <PriorityFlatEstimate stat={stat as keyof StatBlock} pred={pred} weight={w} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-faint">
                  Estimated flat emblem totals for the current priorities on this pool.
                </p>
                <button
                  onClick={() => setCustomWeights({})}
                  className="self-start text-xs text-muted underline hover:text-ink"
                >
                  Reset to Pokémon defaults
                </button>
              </div>
            </CollapsibleCard>
          )}

          {/* Stat Targets (Target mode) */}
          {mode === "target" && (
            <CollapsibleCard title="Stat Targets" persistKey="optimizer-targets">
              <div className="flex flex-col gap-2">
                <p className="text-xs text-faint">
                  Enable stats and enter target flat totals from emblems.
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {Object.entries(STAT_LABELS).map(([stat, label]) => (
                    <div key={stat} className="flex items-center gap-2 text-xs">
                      <label className="flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={!!targetActive[stat]}
                          onChange={(e) => setTargetActive((prev) => ({ ...prev, [stat]: e.target.checked }))}
                          className="accent-accent"
                        />
                        <span className="w-20 text-muted">{label}</span>
                      </label>
                      <input
                        type="number" step="any"
                        value={targetValues[stat] ?? ""}
                        disabled={!targetActive[stat]}
                        onChange={(e) => setTargetValues((prev) => ({ ...prev, [stat]: e.target.value }))}
                        className="w-24 rounded bg-surface px-2 py-1 font-mono text-ink ring-1 ring-line focus:outline-none focus:ring-accent disabled:opacity-40"
                        placeholder="0"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </CollapsibleCard>
          )}

          {/* Protect Floors — works in both maximize and target modes */}
          <CollapsibleCard title="Stat Minimums" persistKey="optimizer-protect" defaultOpen={false}>
            <div className="flex flex-col gap-2">
              <p className="text-xs text-faint">
                {pokemon && Object.keys(floorActive).some((k) => floorActive[k])
                  ? `${presetAutofillIntro(pokemon.displayName, emblemPresetResolution)}. Tries to avoid builds where stats fall below these values. 0 means emblems shouldn't reduce that stat overall; -5 allows up to 5 points of loss.`
                  : "Tries to avoid builds where stats fall below these values. 0 means emblems shouldn't reduce that stat overall; -5 allows up to 5 points of loss."}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {PROTECT_STATS.map(([stat, label]) => (
                  <div key={stat} className="flex items-center gap-2 text-xs">
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={!!floorActive[stat]}
                        onChange={(e) =>
                          setFloorActive((prev) => ({ ...prev, [stat]: e.target.checked }))
                        }
                        className="accent-accent"
                      />
                      <span className="w-20 text-muted">{label}</span>
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={floorValues[stat] ?? "0"}
                      disabled={!floorActive[stat]}
                      onChange={(e) =>
                        setFloorValues((prev) => ({ ...prev, [stat]: e.target.value }))
                      }
                      className="w-20 rounded bg-surface px-2 py-1 font-mono text-xs text-ink ring-1 ring-line focus:outline-none focus:ring-accent disabled:opacity-40"
                      placeholder="0"
                    />
                  </div>
                ))}
              </div>
              <button
                onClick={() => { setFloorActive({}); setFloorValues({}); }}
                className="self-start text-xs text-muted underline hover:text-ink"
              >
                Clear all
              </button>
            </div>
          </CollapsibleCard>

          {/* Search + reset actions */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleAdvancedSearch}
              disabled={!pokemon || advancedNotEnoughEmblems || (colorMode === "exact" && !colorConstraintValid) || searchState.status === "running"}
              className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-accent/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {searchState.status === "running" ? "Searching…" : "Search"}
            </button>
            <button
              onClick={syncAdvancedFromBasic}
              disabled={!pokemon || searchState.status === "running"}
              className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-accent-ink hover:bg-accent-weak active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ↺ Reset to defaults
            </button>
            {colorMode === "exact" && !colorConstraintValid && (
              <span className="text-xs text-neg">Invalid color constraints</span>
            )}
            {searchState.status === "done" && searchState.result && (
              <span className="text-xs text-muted">
                {PHASE_LABEL[searchState.result.phase] ?? searchState.result.phase}
                {" · "}{searchState.result.candidates.toLocaleString()} evaluated
                {" · "}{(searchState.result.totalMs / 1000).toFixed(1)}s
              </span>
            )}
            {searchState.status === "error" && (
              <span className="text-xs text-neg">{searchState.errorMsg}</span>
            )}
          </div>

          {/* Results */}
          {hasResult && resultPicks && (
            <ResultCards
              picks={resultPicks}
              effectiveDelta={effectiveDelta}
              searchResult={searchState.result}
              pokemon={pokemon}
              optimizeLevel={optimizeLevel}
              pokemonAwareScoring={pokemonAwareScoring}
              applied={applied}
              historyCount={historyCount}
              historyIndex={historyIndex}
              onGoHistory={goHistory}
              onApplyEmblems={handleApplyEmblems}
            />
          )}

          {searchState.status === "done" && !searchState.result && (
            <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-faint">
              No valid loadout found. Try expanding the pool or relaxing constraints.
            </p>
          )}
        </>
      )}

      {/* Progress overlay (shared) */}
      {searchState.status === "running" && searchState.progress && (
        <SearchProgressOverlay progress={searchState.progress} eta={searchState.eta} onCancel={cancel} />
      )}

      {/* Apply confirmation toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4"
        >
          <div className="flex items-center gap-3 rounded-xl border border-pos/40 bg-surface px-4 py-2.5 text-sm font-medium text-ink shadow-lg">
            <span className="text-pos">✓</span>
            <span>{toast}</span>
          </div>
        </div>
      )}
    </div>
  );
}
