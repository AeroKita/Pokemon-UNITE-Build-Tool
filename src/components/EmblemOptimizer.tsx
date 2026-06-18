/**
 * EmblemOptimizer — the "⚡ Optimize" page.
 *
 * Two experience levels:
 *
 *  BASIC (default)
 *    Single "Find Best Build" button. The engine auto-derives objectives from
 *    the selected Pokémon's role/attack type using recommend.ts meta-knowledge.
 *    Pool defaults to owned emblems only; user can toggle to the full dataset.
 *    Grade checkboxes and mixed-grades control which candidates are in play.
 *    Held-item suggestions = owned items only
 *    (items the user has explicitly graded; falls back to all if none set).
 *    Shows results: emblem icons, active set bonuses, effective-stat delta,
 *    recommended held items, and Apply buttons.
 *
 *  ADVANCED
 *    Full custom controls: pool source, mode (maximize/target), effort, level,
 *    Pokémon-aware scoring toggle, color constraints, stat priorities/targets.
 *    Pre-filled from the Basic auto-derived values when switching from Basic.
 */

import { useCallback, useMemo, useState } from "react";
import { useStore } from "../state/store";
import {
  emblems as allEmblems,
  heldItems as allHeldItems,
  heldItemById,
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
import { useEmblemSearch } from "../state/emblemSearch";
import { priorityWeights } from "../engine/recommend";
import {
  deriveBasicObjective,
  basicSearchOptions,
  buildBasicPool,
  resolveOwnedHeldItems,
  topPriorityLabels,
  basicObjectiveDescription,
  DEFAULT_ALLOWED_GRADES,
} from "../engine/emblemSearch/basicObjective";
import { colorTargetsFor } from "../engine/recommend";
import { deriveDefaultProtectedStats } from "../engine/emblemSearch/protectDefaults";
import { recommendItemsForEmblemBuild } from "../engine/emblemSearch/heldItemSynergy";
import type {
  PokemonScoringContext,
  SearchOptions,
  SearchMode,
  PoolConfig,
} from "../engine/emblemSearch/types";
import type { EmblemColor, EmblemGrade, HeldItem, StatBlock } from "../types";
import { computeEmblemLoadout } from "../engine/emblems";
import { computeEffectiveStats } from "../engine/formulas";
import { CollapsibleCard } from "./CollapsibleCard";
import { Segmented } from "./Segmented";
import { EmblemSetSummary } from "./EmblemSetSummary";
import { SearchProgressOverlay } from "./SearchProgressOverlay";
import { Tooltip } from "./Tooltip";
import { EMBLEM_COLOR_HEX } from "../ui/colors";
import { emblemIconForGrade } from "../ui/emblemIcon";
import { asset } from "../ui/asset";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SLOTS = 10;

const EFFORT_LABELS = {
  quick: "Quick (~1.5s)",
  normal: "Normal (~8s)",
  thorough: "Thorough (~25s)",
} as const;

type Effort = "quick" | "normal" | "thorough";
type OptimizerMode = "basic" | "advanced";
/** "off" = no color control; "exact" = hard per-color constraints; "weighted" = color-bonus incentive only. */
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
];

const STAT_LABELS: Partial<Record<string, string>> = {
  hp: "HP", attack: "Attack", defense: "Defense", spAttack: "Sp. Attack",
  spDefense: "Sp. Defense", critRate: "Crit Rate", cdr: "CDR",
  attackSpeed: "Atk Speed", moveSpeed: "Move Speed",
};

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

function fmtDelta(stat: keyof StatBlock, delta: number): string {
  if (stat === "critRate" || stat === "cdr" || stat === "lifesteal" || stat === "spLifesteal" || stat === "attackSpeed") {
    return `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}%`;
  }
  if (stat === "moveSpeed") return `${delta >= 0 ? "+" : ""}${Math.round(delta)}`;
  return `${delta >= 0 ? "+" : ""}${delta % 1 === 0 ? delta : delta.toFixed(1)}`;
}

// ---------------------------------------------------------------------------
// Shared result panels (used by both Basic and Advanced)
// ---------------------------------------------------------------------------

interface ResultPanelProps {
  picks: { emblemId: string; grade: EmblemGrade }[];
  effectiveDelta: EffectiveDelta | null;
  heldItemSynergy: ReturnType<typeof recommendItemsForEmblemBuild> | null;
  searchResult: { phase: string; candidates: number; totalMs: number; error?: number } | null;
  pokemon: ReturnType<typeof pokemonById.get> | null;
  optimizeLevel: number;
  pokemonAwareScoring: boolean;
  onApplyEmblems: () => void;
  onApplyItems: (ids: string[]) => void;
}

interface EffectiveDelta {
  delta: Partial<Record<keyof StatBlock, number>>;
  activeSetBonuses: { color: string; bonusPercent: number }[];
}

function ResultCards({
  picks,
  effectiveDelta,
  heldItemSynergy,
  searchResult,
  pokemon,
  optimizeLevel,
  pokemonAwareScoring,
  onApplyEmblems,
  onApplyItems,
}: ResultPanelProps) {
  return (
    <>
      <CollapsibleCard title="Result" persistKey="optimizer-results" tone="indigo">
        <div className="flex flex-col gap-4">
          {/* Emblem icons row */}
          <div className="flex flex-wrap gap-1.5">
            {picks.map((p, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <img
                  src={asset(emblemIconForGrade({ id: p.emblemId }, p.grade))}
                  alt={p.emblemId}
                  className="h-9 w-9 rounded-lg ring-1 ring-line"
                  title={`${p.emblemId} (${p.grade})`}
                />
              </div>
            ))}
          </div>

          <EmblemSetSummary picks={picks} />

          {/* Active set bonuses */}
          {effectiveDelta && effectiveDelta.activeSetBonuses.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {effectiveDelta.activeSetBonuses.map((b) => (
                <span
                  key={b.color}
                  className="flex items-center gap-1 rounded-full border border-line bg-white/10 px-2 py-0.5 text-xs font-medium"
                >
                  <ColorDot color={b.color as EmblemColor} />
                  <span className="capitalize">{b.color}</span>
                  <span className="font-mono text-pos">+{(b.bonusPercent * 100).toFixed(0)}%</span>
                </span>
              ))}
            </div>
          )}

          {/* Effective-stat delta */}
          {effectiveDelta && Object.keys(effectiveDelta.delta).length > 0 && pokemon && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-faint">
                Stat gains at {pokemon.displayName} Lv.{optimizeLevel}
                {pokemonAwareScoring && <span className="ml-1 text-accent-ink">· Pokémon-aware</span>}
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                {(Object.entries(effectiveDelta.delta) as [keyof StatBlock, number][])
                  .filter(([k]) => STAT_LABELS[k])
                  .map(([stat, delta]) => (
                    <div key={stat} className="flex items-center justify-between gap-1">
                      <span className="text-muted">{STAT_LABELS[stat]}</span>
                      <span className={`font-mono font-semibold ${delta >= 0 ? "text-pos" : "text-neg"}`}>
                        {fmtDelta(stat, delta)}
                      </span>
                    </div>
                  ))}
              </div>
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

          <button
            onClick={onApplyEmblems}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-accent/90 active:scale-95"
          >
            Apply Emblems to Loadout
          </button>
        </div>
      </CollapsibleCard>

      {/* Held items synergy card */}
      {heldItemSynergy && pokemon && (
        <CollapsibleCard title="Recommended Held Items" persistKey="optimizer-items" tone="sky">
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted">{heldItemSynergy.reasoning}</p>
            <div className="flex flex-wrap gap-4">
              {heldItemSynergy.suggestions.map((sug) => {
                const item = heldItemById.get(sug.itemId);
                if (!item) return null;
                return (
                  <Tooltip
                    key={sug.itemId}
                    content={
                      <div className="flex flex-col gap-1 text-xs">
                        <span className="font-semibold">{sug.displayName}</span>
                        <span className="text-muted">{sug.reason}</span>
                      </div>
                    }
                  >
                    <div className="flex flex-col items-center gap-1">
                      <img
                        src={asset(item.iconAsset)}
                        alt={item.displayName}
                        className="h-11 w-11 rounded-xl ring-1 ring-line"
                      />
                      <span className="max-w-[60px] text-center text-[10px] leading-tight text-muted">
                        {item.displayName}
                      </span>
                      <span className="max-w-[60px] text-center text-[10px] leading-tight text-faint">
                        {sug.reason}
                      </span>
                    </div>
                  </Tooltip>
                );
              })}
            </div>
            <button
              onClick={() => onApplyItems(heldItemSynergy.suggestions.map((s) => s.itemId))}
              className="self-start rounded-xl border border-line bg-white/10 px-4 py-1.5 text-xs font-medium text-ink hover:bg-white/20 active:scale-95"
            >
              Apply Held Items to Loadout
            </button>
          </div>
        </CollapsibleCard>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EmblemOptimizer({ onNavigate }: { onNavigate?: (page: string) => void } = {}) {
  const { loadout, dispatch, owned, heldSlotGrades, ownedHeldItemIds } = useStore();
  const pokemon = loadout.pokemonId ? pokemonById.get(loadout.pokemonId) ?? null : null;

  // ---- Top-level mode ----
  const [optimizerMode, setOptimizerMode] = useState<OptimizerMode>("basic");

  // ---- Pool state (Basic vs Advanced pool source are independent) ----
  const [basicUseOwned, setBasicUseOwned] = useState(true);
  const [useOwned, setUseOwned] = useState(false);
  const [mixedGrades, setMixedGrades] = useState(true);
  const [allowedGrades, setAllowedGrades] = useState<Set<EmblemGrade>>(
    () => new Set(DEFAULT_ALLOWED_GRADES),
  );
  const [mode, setMode] = useState<SearchMode>("maximize");
  const [effort, setEffort] = useState<Effort>("normal");
  const [colorBonuses, setColorBonuses] = useState(true);
  const [optimizeLevel, setOptimizeLevel] = useState<number>(loadout.level ?? 15);
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

  const basicPoolConfig: PoolConfig = { useOwned: basicUseOwned, mixedGrades, allowedGrades };
  const basicPool = useMemo(
    () => buildBasicPool(allEmblems, owned, basicPoolConfig),
    [owned, basicUseOwned, mixedGrades, allowedGrades],
  );
  const basicBuildCount = useMemo(() => approximateBuildCount(basicPool, SLOTS), [basicPool]);
  const basicPoolDistinctNames = useMemo(() => distinctPokemonCount(basicPool), [basicPool]);

  // ---- Auto-derived Basic objective ----
  // Pass pokemonList so protect floors are derived from population statistics.
  // pokemonList is a module-level constant (doesn't change) so it's safe to
  // omit from the dep array per the React rules-of-hooks exhaustive-deps advice
  // for stable references.
  const basicObjective = useMemo(() => {
    if (!pokemon) return null;
    return deriveBasicObjective(pokemon, optimizeLevel, allEmblems, pokemonList);
  }, [pokemon, optimizeLevel]);

  // ---- Advanced weights + context ----
  const defaultWeights = useMemo(
    () => (pokemon ? priorityWeights(pokemon) : {}),
    [pokemon],
  );
  const priorities = useMemo(() => ({ ...defaultWeights, ...customWeights }), [defaultWeights, customWeights]);

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
  const { state: searchState, run, cancel } = useEmblemSearch();

  // Sync Advanced controls from Basic defaults (called when switching Basic→Advanced
  // via the segmented control, the "switch to Advanced" buttons, or ↺ Reset).
  // Advanced defaults: full dataset pool + exact meta colors + protect defaults.
  const syncAdvancedFromBasic = useCallback(() => {
    const level = loadout.level ?? 15;
    const grades = new Set(DEFAULT_ALLOWED_GRADES);
    setUseOwned(false);          // Advanced defaults to the full 258-emblem dataset
    setMixedGrades(true);
    setAllowedGrades(grades);
    setMode("maximize");
    setColorBonuses(true);
    setPokemonAwareScoring(true);
    setCustomWeights({});
    setOptimizeLevel(level);
    setExactCap(DEFAULT_EXACT_CAP);

    // --- Protect defaults (always derived from the selected Pokémon) ---
    if (pokemon) {
      const floors = deriveDefaultProtectedStats(pokemon, pokemonList, level);
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

    // --- Color defaults ---
    if (pokemon) {
      const byId = new Map(allEmblems.map((e) => [e.id, e]));
      const targets = colorTargetsFor(pokemon, byId);
      if (targets.size > 0) {
        const fullPool = buildPool(allEmblems, { useOwned: false, mixedGrades: true, allowedGrades: grades }, owned);
        const caps = colorGroupSizes(fullPool);
        const sum = [...targets.values()].reduce((a, b) => a + b, 0);
        const capacityOk = [...targets.entries()].every(([c, n]) => n <= (caps.get(c) ?? 0));
        const feasible =
          sum <= 2 * SLOTS &&
          capacityOk &&
          countConstrainedBuilds(fullPool, targets, SLOTS) !== 0n;
        setActiveColors(new Set(targets.keys()));
        setColorCounts(
          Object.fromEntries(POSITIVE_COLORS.map((c) => [c, targets.get(c) ?? 0])) as Record<EmblemColor, number>,
        );
        setColorMode(feasible ? "exact" : "weighted");
        return;
      }
    }
    // No Pokémon or no meta targets → clear color state
    setColorMode("off");
    setActiveColors(new Set());
    setColorCounts(Object.fromEntries(POSITIVE_COLORS.map((c) => [c, 0])) as Record<EmblemColor, number>);
  }, [loadout.level, pokemon, allEmblems, owned]);


  const handleModeSwitch = useCallback((next: OptimizerMode) => {
    if (next === "advanced" && optimizerMode === "basic") syncAdvancedFromBasic();
    setOptimizerMode(next);
  }, [optimizerMode, syncAdvancedFromBasic]);

  // Basic search
  const handleBasicSearch = useCallback(async () => {
    if (!basicObjective || basicPool.length < SLOTS) return;
    const opts = basicSearchOptions(basicObjective);
    await run(basicPool, opts, setBonuses, effort);
  }, [basicObjective, basicPool, effort, run]);

  // Advanced search (Advanced tab only — pool source toggle applies here, not in Basic)
  const handleAdvancedSearch = useCallback(async () => {
    if (pool.length < SLOTS) return;
    await run(pool, advancedSearchOptions, setBonuses, effort);
  }, [pool, advancedSearchOptions, effort, run]);

  // Apply emblem picks to loadout
  const handleApplyEmblems = useCallback(() => {
    const result = searchState.result;
    if (!result?.picks.length) return;
    dispatch({
      type: "applyBuild",
      heldItemIds: loadout.heldItemIds,
      battleItemId: loadout.battleItemId,
      emblems: result.picks.map((s) => ({ emblemId: s.emblem.id, grade: s.grade })),
    });
  }, [searchState.result, loadout, dispatch]);

  // Apply suggested held items to loadout
  const handleApplyItems = useCallback((itemIds: string[]) => {
    const result = searchState.result;
    if (!result) return;
    dispatch({
      type: "applyBuild",
      heldItemIds: [itemIds[0] ?? null, itemIds[1] ?? null, itemIds[2] ?? null],
      battleItemId: loadout.battleItemId,
      emblems: result.picks.map((s) => ({ emblemId: s.emblem.id, grade: s.grade })),
    });
  }, [searchState.result, loadout, dispatch]);

  // ---- Result picks ----
  const resultPicks = useMemo(
    () => searchState.result?.picks.map((s) => ({ emblemId: s.emblem.id, grade: s.grade })),
    [searchState.result],
  );
  const hasResult = (searchState.status === "done" || searchState.status === "cancelled")
    && !!resultPicks?.length;

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

      return { delta, activeSetBonuses: emblemLoadout.activeSetBonuses };
    } catch {
      return null;
    }
  }, [searchState.result, pokemon, optimizeLevel, loadout.heldItemIds, heldSlotGrades]);

  // ---- Held items synergy ----
  // In Basic mode: restrict to owned held items (graceful fallback to all)
  const ownedItems = useMemo(
    () => resolveOwnedHeldItems(allHeldItems, ownedHeldItemIds),
    [ownedHeldItemIds],
  );

  const heldItemSynergy = useMemo(() => {
    const result = searchState.result;
    if (!result || !pokemon || !result.picks.length) return null;
    const itemPool = optimizerMode === "basic" ? ownedItems : allHeldItems;
    try {
      return recommendItemsForEmblemBuild(pokemon, optimizeLevel, result.picks, setBonuses, itemPool, 30);
    } catch {
      return null;
    }
  }, [searchState.result, pokemon, optimizeLevel, optimizerMode, ownedItems]);

  // ---- Basic mode info ----
  const basicPriorityLabels = useMemo(
    () => (basicObjective ? topPriorityLabels(basicObjective.priorities) : []),
    [basicObjective],
  );
  const basicNotEnoughEmblems = basicPool.length < SLOTS;

  // ---- Render ----
  return (
    <div className="flex flex-col gap-4">
      {/* Mode toggle header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">⚡ Emblem Optimizer</h2>
          <p className="text-xs text-muted">
            {optimizerMode === "basic"
              ? basicUseOwned
                ? "One-click build optimised for your Pokémon from your owned collection."
                : "One-click build optimised for your Pokémon from the full emblem dataset."
              : "Full control over pool, objectives, and scoring."}
          </p>
        </div>
        <Segmented<OptimizerMode>
          value={optimizerMode}
          options={["basic", "advanced"]}
          onChange={handleModeSwitch}
          labels={{ basic: "Basic", advanced: "Advanced" }}
        />
      </div>

      {/* ================================================================== */}
      {/* BASIC MODE                                                          */}
      {/* ================================================================== */}
      {optimizerMode === "basic" && (
        <>
          {/* Auto-objective summary card */}
          {pokemon ? (
            <div className="rounded-2xl border border-line bg-surface px-4 py-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <img
                    src={asset(pokemon.imageAsset)}
                    alt={pokemon.displayName}
                    className="h-10 w-10 rounded-full bg-white/10 object-cover ring-1 ring-line"
                  />
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {pokemon.displayName}
                      <span className="ml-2 text-xs font-normal text-muted">
                        {basicObjectiveDescription(pokemon)} · Lv.{optimizeLevel}
                      </span>
                    </p>
                    {basicPriorityLabels.length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {basicPriorityLabels.map((l) => (
                          <span key={l} className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent-ink">
                            {l}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right text-xs text-muted">
                  <p>
                    {basicPool.length.toLocaleString()} emblem candidate{basicPool.length !== 1 ? "s" : ""}
                    {" · "}{basicPoolDistinctNames} Pokémon
                  </p>
                  {basicPool.length > basicPoolDistinctNames && basicUseOwned && (
                    <p className="text-faint">
                      {mixedGrades
                        ? `Mixed grades · ~${formatBuildCount(basicBuildCount)} builds`
                        : "Best owned grade only"}
                    </p>
                  )}
                  {basicPool.length > basicPoolDistinctNames && !basicUseOwned && (
                    <p className="text-faint">
                      {[...allowedGrades].sort().join("/")} grades · ~{formatBuildCount(basicBuildCount)} builds
                    </p>
                  )}
                  {ownedHeldItemIds.length > 0 && (
                    <p>{ownedItems.length} owned items</p>
                  )}
                </div>
              </div>

              {/* Color targets row */}
              {basicObjective && basicObjective.colorTargets.size > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
                  <span className="text-xs text-faint">Target colors:</span>
                  {[...basicObjective.colorTargets.entries()].map(([col, n]) => (
                    <span key={col} className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs">
                      <ColorDot color={col as EmblemColor} />
                      <span className="capitalize">{col}</span>
                      <span className="font-mono text-muted">×{n}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-muted shadow-sm">
              Select a Pokémon in the Builder first to enable Basic optimization.
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
                page, enable mixed grades above, or{" "}
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
                  onClick={() => handleModeSwitch("advanced")}
                  className="font-medium text-accent-ink underline"
                >
                  switch to Advanced
                </button>{" "}
                for finer pool control.
              </p>
            </div>
          )}

          {/* Effort selector (subtle, but accessible) */}
          {pokemon && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-muted">Search effort:</span>
              {(Object.entries(EFFORT_LABELS) as [Effort, string][]).map(([e, label]) => (
                <label key={e} className="flex cursor-pointer items-center gap-1.5 text-xs">
                  <input
                    type="radio"
                    checked={effort === e}
                    onChange={() => setEffort(e)}
                    className="accent-accent"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          )}

          {/* Level control */}
          {pokemon && (
            <div className="flex items-center gap-3">
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
          )}

          {/* Pool source + grades */}
          {pokemon && (
            <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-muted">Search pool</p>
              <div className="flex flex-wrap gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={basicUseOwned}
                    onChange={() => setBasicUseOwned(true)}
                    className="accent-accent"
                  />
                  <span>Owned emblems only</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={!basicUseOwned}
                    onChange={() => setBasicUseOwned(false)}
                    className="accent-accent"
                  />
                  <span>Full dataset (all 258)</span>
                </label>
              </div>
              {!basicUseOwned && (
                <div className="flex flex-wrap gap-3 text-sm">
                  <span className="text-muted">Grades:</span>
                  {(["gold", "silver", "bronze"] as EmblemGrade[]).map((g) => (
                    <label key={g} className="flex cursor-pointer items-center gap-1.5 capitalize">
                      <input
                        type="checkbox"
                        checked={allowedGrades.has(g)}
                        onChange={(e) => {
                          const next = new Set(allowedGrades);
                          e.target.checked ? next.add(g) : next.delete(g);
                          if (next.size > 0) setAllowedGrades(next);
                        }}
                        className="accent-accent"
                      />
                      {g}
                    </label>
                  ))}
                </div>
              )}
              {basicUseOwned && (
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
                      — combine Bronze/Silver/Gold across the 10 slots (recommended)
                    </span>
                  </span>
                </label>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleBasicSearch}
              disabled={!pokemon || basicNotEnoughEmblems || searchState.status === "running"}
              className="rounded-xl bg-accent px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-accent/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {searchState.status === "running" ? "Searching…" : "Find Best Build"}
            </button>
            {searchState.status === "done" && searchState.result && (
              <span className="text-xs text-muted">
                {searchState.result.candidates.toLocaleString()} candidates · {(searchState.result.totalMs / 1000).toFixed(1)}s
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
              heldItemSynergy={heldItemSynergy}
              searchResult={searchState.result}
              pokemon={pokemon}
              optimizeLevel={optimizeLevel}
              pokemonAwareScoring
              onApplyEmblems={handleApplyEmblems}
              onApplyItems={handleApplyItems}
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
                  as owned, enabling mixed grades, or{" "}
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
                    onClick={() => handleModeSwitch("advanced")}
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
      {/* ADVANCED MODE                                                       */}
      {/* ================================================================== */}
      {optimizerMode === "advanced" && (
        <>
          {/* Reset to Basic defaults */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">
              Custom search — adjust any setting below.
            </p>
            <button
              onClick={syncAdvancedFromBasic}
              className="text-xs font-medium text-accent-ink underline hover:opacity-80"
            >
              ↺ Reset to auto defaults
            </button>
          </div>

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
              <div className="flex flex-wrap gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="radio" checked={useOwned} onChange={() => setUseOwned(true)} className="accent-accent" />
                  <span>Owned emblems only</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="radio" checked={!useOwned} onChange={() => setUseOwned(false)} className="accent-accent" />
                  <span>Full dataset (all 258)</span>
                </label>
              </div>
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
                      — combine Bronze/Silver/Gold across the 10 slots (recommended)
                    </span>
                  </span>
                </label>
              )}
              {!useOwned && (
                <div className="flex flex-wrap gap-3 text-sm">
                  <span className="text-muted">Grades:</span>
                  {(["gold", "silver", "bronze"] as EmblemGrade[]).map((g) => (
                    <label key={g} className="flex cursor-pointer items-center gap-1.5 capitalize">
                      <input
                        type="checkbox"
                        checked={allowedGrades.has(g)}
                        onChange={(e) => {
                          const next = new Set(allowedGrades);
                          e.target.checked ? next.add(g) : next.delete(g);
                          if (next.size > 0) setAllowedGrades(next);
                        }}
                        className="accent-accent"
                      />
                      {g}
                    </label>
                  ))}
                </div>
              )}
              {/* Search-space display + exact/heuristic indicator */}
              <div className="flex flex-col gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs text-muted">
                <div className="flex items-center gap-2">
                  <span>Search space:</span>
                  {colorMode === "exact" && colorConstraints && colorConstraintValid ? (
                    constrainedBuildCount === null ? (
                      <>
                        <span className="font-mono font-semibold text-ink">many</span>
                        <span>builds matching color targets (too many to count)</span>
                      </>
                    ) : constrainedBuildCount === 0n ? (
                      <>
                        <span className="font-mono font-semibold text-neg">0</span>
                        <span>builds match — pool cannot satisfy these exact counts</span>
                      </>
                    ) : (
                      <>
                        <span className="font-mono font-semibold text-ink">{formatBuildCount(constrainedBuildCount)}</span>
                        <span>builds match color targets</span>
                        <span className="text-faint">(of {formatBuildCount(buildCount)} total)</span>
                      </>
                    )
                  ) : (
                    <>
                      <span className="font-mono font-semibold text-ink">{formatBuildCount(buildCount)}</span>
                      <span>combinations</span>
                    </>
                  )}
                </div>
                {/* Grade-reactive candidate count — changes when allowedGrades /
                    mixedGrades changes, giving immediate feedback that grade
                    selection affects the pool the optimizer uses. The combination
                    count above (C(n,10)) is grade-independent (it counts distinct
                    Pokémon name-sets); this line shows the grade dimension. */}
                <div className="text-[11px] text-faint">
                  {candidateCount.toLocaleString()} emblem candidates
                  {" · "}{poolDistinctNames} Pokémon
                  {candidateCount > poolDistinctNames
                    ? ` × ${(candidateCount / poolDistinctNames).toFixed(1)} grades avg`
                    : " (1 grade)"}
                </div>
                {/* Exact vs heuristic indicator — only shown when exact color mode is active */}
                {colorMode === "exact" && colorConstraints && colorConstraintValid && constrainedBuildCount !== null && constrainedBuildCount > 0n && (
                  <div className={`flex items-center gap-1 text-[11px] font-medium ${willRunExact ? "text-pos" : "text-faint"}`}>
                    {willRunExact
                      ? `⚡ Exact search (${formatBuildCount(constrainedBuildCount)} ≤ cap ${formatBuildCount(BigInt(exactCap))})`
                      : `~ Heuristic search (${formatBuildCount(constrainedBuildCount)} > cap ${formatBuildCount(BigInt(exactCap))})`}
                  </div>
                )}
              </div>
            </div>
          </CollapsibleCard>

          {/* Mode & Effort */}
          <CollapsibleCard title="Mode & Effort" persistKey="optimizer-mode">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-4">
                {(["maximize", "target"] as SearchMode[]).map((m) => (
                  <label key={m} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="radio" checked={mode === m} onChange={() => setMode(m)} className="accent-accent" />
                    <span className="capitalize">{m}</span>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-3">
                {(Object.entries(EFFORT_LABELS) as [Effort, string][]).map(([e, label]) => (
                  <label key={e} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="radio" checked={effort === e} onChange={() => setEffort(e)} className="accent-accent" />
                    <span>{label}</span>
                  </label>
                ))}
              </div>

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
                    <span>Include color set-bonus incentive in score</span>
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

              {/* Exact search cap — only relevant when color mode is "exact" */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted" htmlFor="adv-exact-cap">
                    Max permutations before heuristics
                  </label>
                  {exactCap !== DEFAULT_EXACT_CAP && (
                    <button
                      onClick={() => setExactCap(DEFAULT_EXACT_CAP)}
                      className="text-[10px] text-faint underline hover:text-muted"
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
                  <span className="text-[10px] text-faint">
                    {exactCap.toLocaleString()} — {colorMode === "exact" && willRunExact ? "⚡ exact" : colorMode === "exact" ? "~ heuristic" : "n/a"}
                  </span>
                </div>
                <p className="text-[10px] text-faint">
                  When color mode is Exact and the matching build count is ≤ this cap,
                  the search exhaustively evaluates every valid combination (guaranteed
                  optimum). Above the cap, the heuristic runs instead.
                  Default: {DEFAULT_EXACT_CAP.toLocaleString()}.
                </p>
              </div>
            </div>
          </CollapsibleCard>

          {/* Color mode */}
          <CollapsibleCard title="Color" persistKey="optimizer-colors" defaultOpen={false}>
            <div className="flex flex-col gap-3">
              {/* Mode selector */}
              <div className="flex flex-col gap-1">
                <span className="text-xs text-faint">Color control mode</span>
                <Segmented<ColorMode>
                  value={colorMode}
                  options={["off", "weighted", "exact"]}
                  onChange={setColorMode}
                  labels={{ off: "Off", weighted: "Weighted", exact: "Exact" }}
                />
              </div>

              {/* Weighted mode description */}
              {colorMode === "weighted" && (
                <p className="text-xs text-muted">
                  The search is softly steered toward high color set-bonus tiers via incentive
                  scoring — no build is rejected. Color bonus incentive is forced on.
                  Use <strong>Exact</strong> to require specific per-color counts.
                </p>
              )}

              {/* Count inputs — shown in both Exact and Weighted (preview in Weighted) */}
              {colorMode !== "off" && (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {POSITIVE_COLORS.map((col) => (
                      <label key={col} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-white/5 p-2 text-xs">
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
                        {activeColors.has(col) && (
                          <input
                            type="number"
                            min={0}
                            max={Math.min(SLOTS, colorCapacities.get(col) ?? SLOTS)}
                            value={colorCounts[col] ?? 0}
                            onChange={(e) => setColorCounts((prev) => ({ ...prev, [col]: parseInt(e.target.value) || 0 }))}
                            className="w-10 rounded bg-surface px-1 py-0.5 text-center font-mono text-ink ring-1 ring-line focus:outline-none focus:ring-accent"
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                      </label>
                    ))}
                  </div>

                  {/* Exact-mode validation messages */}
                  {colorMode === "exact" && !colorConstraintValid && (
                    <p className="text-xs text-neg">
                      {totalColorConstrained > 2 * SLOTS
                        ? `Color-point sum ${totalColorConstrained} exceeds ${2 * SLOTS} (max for ${SLOTS} dual-color emblems).`
                        : "A color count exceeds what the current pool can provide — reduce it or expand the pool."}
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
                      Counts shown for reference — the search uses bonus incentive scoring, not hard constraints.
                    </p>
                  )}

                  {/* ── Proposed bonus preview (both modes) ─────────────── */}
                  {colorBonusPreviews.length > 0 && (
                    <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-white/5 p-2">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-faint">
                        Proposed bonuses
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
                                : ` (≈ +${Math.floor(delta)})`
                              : null;
                          return (
                            <span
                              key={b.color}
                              title={`${b.color} ×${b.count} → Tier ${b.tier}`}
                              className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-ink"
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
                        <span className="text-[10px] text-faint">
                          Concrete values based on {pokemon.displayName} at level {optimizeLevel}.
                        </span>
                      )}
                    </div>
                  )}
                  {activeColors.size > 0 && colorBonusPreviews.length === 0 && (
                    <p className="text-[11px] text-faint">
                      Proposed bonuses: none — these counts don't reach a color tier.
                    </p>
                  )}

                  {/* ── Affected pool size ───────────────────────────────── */}
                  {colorMode === "exact" && colorConstraintValid && (
                    <div className="text-[11px] text-muted">
                      {constrainedBuildCount === null
                        ? "Matching builds in pool: too many to count."
                        : constrainedBuildCount === 0n
                        ? <span className="text-neg">Matching builds in pool: 0 — no combination hits these exact counts.</span>
                        : <>
                            Matching builds in pool:{" "}
                            <span className="font-medium text-ink">
                              {formatBuildCount(constrainedBuildCount)}
                            </span>{" "}
                            {willRunExact
                              ? <span className="text-pos">⚡ exact search</span>
                              : <span className="text-muted">~ heuristic (above cap)</span>}
                          </>
                      }
                    </div>
                  )}
                  {colorMode === "weighted" && activeColors.size > 0 && (
                    <div className="text-[11px] text-muted">
                      Pool size (unconstrained):{" "}
                      <span className="font-medium text-ink">{formatBuildCount(buildCount)}</span>{" "}
                      builds — color bonuses steer scoring, not the feasible set.
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
                    ? `Auto-generated from ${pokemon.displayName}'s role. Adjust to change priorities.`
                    : "Select a Pokémon to auto-populate weights."}
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {Object.entries(STAT_LABELS).map(([stat, label]) => {
                    const w = priorities[stat as keyof typeof priorities] ?? 0;
                    return (
                      <div key={stat} className="flex items-center gap-2 text-xs">
                        <span className="w-24 text-muted">{label}</span>
                        <input
                          type="range" min={0} max={5} step={0.5}
                          value={w}
                          onChange={(e) =>
                            setCustomWeights((prev) => ({ ...prev, [stat]: parseFloat(e.target.value) }))
                          }
                          className="flex-1 accent-accent"
                        />
                        <span className="w-8 text-right font-mono text-ink">{w.toFixed(1)}</span>
                      </div>
                    );
                  })}
                </div>
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
                <p className="text-xs text-faint">Enter desired flat stat totals from emblems.</p>
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
          <CollapsibleCard title="Protect Stats" persistKey="optimizer-protect" defaultOpen={false}>
            <div className="flex flex-col gap-2">
              <p className="text-xs text-faint">
                Penalise builds where the total flat emblem contribution to a stat falls below
                the floor. Floor&nbsp;=&nbsp;0 (default) means "don't let emblems net-reduce
                this stat" — e.g. prevents pink emblems from eroding HP if HP is protected.
                {pokemon && Object.keys(floorActive).some((k) => floorActive[k]) && (
                  <span className="ml-1 text-accent-ink">
                    Auto-filled for {pokemon.displayName} — adjust freely.
                  </span>
                )}
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
                Clear all protect floors
              </button>
            </div>
          </CollapsibleCard>

          {/* Search button */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleAdvancedSearch}
              disabled={pool.length < SLOTS || (colorMode === "exact" && !colorConstraintValid) || searchState.status === "running"}
              className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-accent/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {searchState.status === "running" ? "Searching…" : "Search"}
            </button>
            {pool.length < SLOTS && (
              <span className="text-xs text-neg">
                Need ≥{SLOTS} emblems in pool (have {pool.length})
              </span>
            )}
            {colorMode === "exact" && !colorConstraintValid && (
              <span className="text-xs text-neg">Invalid color constraints</span>
            )}
            {searchState.status === "done" && searchState.result && (
              <span className="text-xs text-muted">
                Found via <strong>{searchState.result.phase}</strong> · {searchState.result.candidates.toLocaleString()} candidates · {(searchState.result.totalMs / 1000).toFixed(1)}s
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
              heldItemSynergy={heldItemSynergy}
              searchResult={searchState.result}
              pokemon={pokemon}
              optimizeLevel={optimizeLevel}
              pokemonAwareScoring={pokemonAwareScoring}
              onApplyEmblems={handleApplyEmblems}
              onApplyItems={handleApplyItems}
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
    </div>
  );
}
