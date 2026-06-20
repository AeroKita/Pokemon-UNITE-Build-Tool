import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "./store";
import type { EmblemPick } from "./loadout";
import {
  emblems as allEmblems,
  heldItemById,
  setBonuses,
  pokemonById,
  pokemonList,
} from "../data/gameData";
import {
  buildPool,
  approximateBuildCount,
  countConstrainedBuilds,
  countExactEnumerationSpace,
  distinctPokemonCount,
} from "../engine/emblemSearch/pool";
import { colorGroupSizes } from "../engine/emblemSearch/exactColor";
import { DEFAULT_EXACT_CAP, shouldRunExact } from "../engine/emblemSearch/orchestrator";
import {
  proposedColorBonuses,
  type ColorBonusPreviewItem,
} from "../engine/emblemSearch/colorBonusPreview";
import { useEmblemSearch, buildSearchSettingsKey, DEFAULT_RESULT_COUNT } from "./emblemSearch";
import { priorityWeights } from "../engine/recommend";
import {
  deriveBasicObjective,
  buildBasicPool,
  BASIC_POOL_DEFAULTS,
  DEFAULT_ALLOWED_GRADES,
} from "../engine/emblemSearch/basicObjective";
import {
  buildPresetSearchOptions,
  deriveAdvancedColorUiDefaults,
  resolveBasicSearchParams,
  resolveColorSearchMode,
  type BasicEffort,
} from "../engine/emblemSearch/searchPresets";
import { deriveProtectFloors } from "../engine/emblemSearch/protectDefaults";
import {
  presetPriorities,
  presetProtectFloors,
  resolveEmblemPreset,
} from "../engine/emblemSearch/optimizerPresets";
import { predictFlatStatRanges } from "../engine/emblemSearch/predictStats";
import type {
  PokemonScoringContext,
  SearchOptions,
  SearchMode,
  PoolConfig,
} from "../engine/emblemSearch/types";
import type { EmblemColor, EmblemGrade, HeldItem, StatBlock } from "../types";
import { computeEmblemLoadout } from "../engine/emblems";
import { computeEffectiveStats } from "../engine/formulas";
import {
  emblemPicksFromResult,
  POSITIVE_COLORS,
  SLOTS,
  type AppliedState,
  type ColorMode,
  type Effort,
  type EffectiveDelta,
  type OptimizerAdvancedProps,
  type OptimizerBasicProps,
  type OptimizerSharedProps,
} from "../components/optimizer/shared";

export function useEmblemOptimizer(): {
  shared: OptimizerSharedProps;
  basic: OptimizerBasicProps;
  advanced: OptimizerAdvancedProps;
} {
  const { loadout, dispatch, owned, heldSlotGrades, expert } = useStore();
  const pokemon = loadout.pokemonId ? (pokemonById.get(loadout.pokemonId) ?? null) : null;

  const [basicUseOwned, setBasicUseOwned] = useState(BASIC_POOL_DEFAULTS.useOwned);
  const [useOwned, setUseOwned] = useState(BASIC_POOL_DEFAULTS.useOwned);
  const [mixedGrades, setMixedGrades] = useState(BASIC_POOL_DEFAULTS.mixedGrades);
  const [allowedGrades, setAllowedGrades] = useState<Set<EmblemGrade>>(
    () => new Set(DEFAULT_ALLOWED_GRADES),
  );
  const [mode, setMode] = useState<SearchMode>("maximize");
  const [effort, setEffort] = useState<Effort>("normal");
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

  const enumerateGradeVariants = mixedGrades;

  const poolConfig = useMemo<PoolConfig>(
    () => ({ useOwned, mixedGrades, allowedGrades }),
    [useOwned, mixedGrades, allowedGrades],
  );
  const pool = useMemo(() => buildPool(allEmblems, poolConfig, owned), [poolConfig, owned]);
  const buildCount = useMemo(() => approximateBuildCount(pool, SLOTS), [pool]);
  const candidateCount = pool.length;
  const poolDistinctNames = useMemo(() => distinctPokemonCount(pool), [pool]);

  const basicPoolConfig = useMemo<PoolConfig>(
    () => ({
      useOwned: basicUseOwned,
      mixedGrades: BASIC_POOL_DEFAULTS.mixedGrades,
      allowedGrades,
    }),
    [basicUseOwned, allowedGrades],
  );
  const basicPool = useMemo(
    () => buildBasicPool(allEmblems, owned, basicPoolConfig),
    [owned, basicPoolConfig],
  );

  const basicNotEnoughEmblems = basicPool.length < SLOTS;
  const advancedNotEnoughEmblems = pool.length < SLOTS;

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

  const basicColorResolution = useMemo(() => {
    if (!basicObjective) return null;
    return resolveColorSearchMode(
      basicPool,
      basicObjective.colorTargets as Map<EmblemColor, number>,
      SLOTS,
      BASIC_POOL_DEFAULTS.mixedGrades,
    );
  }, [basicObjective, basicPool]);

  const basicExactColorFeasible = basicColorResolution?.mode === "exact";
  const basicExactEnumFeasible = basicColorResolution?.willRunExact ?? false;

  const basicSearchParams = useMemo(
    () => resolveBasicSearchParams(basicEffort, basicColorResolution),
    [basicEffort, basicColorResolution],
  );
  const { displayEffort: resolvedBasicEffort, willRunExact: basicWillRunExactSearch } =
    basicSearchParams;

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
  const priorities = useMemo(
    () => ({ ...defaultWeights, ...customWeights }),
    [defaultWeights, customWeights],
  );

  const flatStatPredictionByStat = useMemo(() => {
    const m = new Map<
      keyof StatBlock,
      import("../engine/emblemSearch/predictStats").FlatStatPrediction
    >();
    if (mode !== "maximize") return m;
    let targets: Map<EmblemColor, number> | undefined;
    if (colorMode !== "off" && activeColors.size > 0) {
      targets = new Map<EmblemColor, number>();
      for (const col of activeColors) {
        const n = colorCounts[col] ?? 0;
        if (n > 0) targets.set(col, n);
      }
    }
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

  const colorCapacities = useMemo(() => colorGroupSizes(pool), [pool]);

  const colorConstraintValid = useMemo(() => {
    if (!colorConstraints) return true;
    if (totalColorConstrained > 2 * SLOTS) return false;
    for (const [col, need] of colorConstraints) {
      const cap = Math.min(SLOTS, colorCapacities.get(col) ?? 0);
      if (need > cap) return false;
    }
    return true;
  }, [colorConstraints, totalColorConstrained, colorCapacities]);

  const constrainedBuildCount = useMemo(() => {
    if (!colorConstraints || !colorConstraintValid) return null;
    return countConstrainedBuilds(pool, colorConstraints, SLOTS);
  }, [pool, colorConstraints, colorConstraintValid]);

  const exactEnumerationCount = useMemo(() => {
    if (!colorConstraints || !colorConstraintValid) return null;
    return countExactEnumerationSpace(pool, colorConstraints, SLOTS, enumerateGradeVariants);
  }, [pool, colorConstraints, colorConstraintValid, enumerateGradeVariants]);

  const willRunExact = useMemo(() => {
    if (colorMode !== "exact" || !colorConstraints || !colorConstraintValid) return false;
    return shouldRunExact(exactEnumerationCount, exactCap);
  }, [colorMode, colorConstraints, colorConstraintValid, exactEnumerationCount, exactCap]);

  const searchWillRunExact = expert ? willRunExact : basicWillRunExactSearch;
  const effectiveResultCount = searchWillRunExact ? 1 : resultCount;

  const colorBonusPreviews = useMemo<ColorBonusPreviewItem[]>(() => {
    if (colorMode === "off" || activeColors.size === 0) return [];
    const counts = new Map<EmblemColor, number>();
    for (const col of activeColors) {
      const n = colorCounts[col] ?? 0;
      if (n > 0) counts.set(col, n);
    }
    return proposedColorBonuses(counts, setBonuses);
  }, [colorMode, activeColors, colorCounts]);

  const advancedSearchOptions: SearchOptions = useMemo(
    () => ({
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
      colorBonuses: colorMode === "weighted" ? true : colorBonuses,
      scoringMode: pokemonAwareScoring && pokemon ? "pokemon" : "classic",
      pokemonContext,
      slots: SLOTS,
      exactCap,
      enumerateGradeVariants,
    }),
    [
      mode,
      priorities,
      targetValues,
      targetActive,
      floorValues,
      floorActive,
      colorConstraints,
      colorMode,
      colorBonuses,
      pokemonAwareScoring,
      pokemon,
      pokemonContext,
      exactCap,
      enumerateGradeVariants,
    ],
  );

  const { state: searchState, run, cancel, clearResult, goHistory } = useEmblemSearch();

  const searchSettingsKey = useMemo(
    () =>
      buildSearchSettingsKey({
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

  const [applied, setApplied] = useState<AppliedState>({ emblems: false });
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    setApplied({ emblems: false });
  }, [searchState.result, searchState.historyIndex]);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  const applyEmblemsToLoadout = useCallback(
    (emblems: EmblemPick[]) => {
      if (!emblems.length) return;
      dispatch({ type: "applyBuild", emblems });
      setApplied({ emblems: true });
      showToast(
        `Applied ${emblems.length} emblem${emblems.length !== 1 ? "s" : ""} to your loadout.`,
      );
    },
    [dispatch, showToast],
  );

  const handleApplyEmblems = useCallback(() => {
    applyEmblemsToLoadout(resultPicks ?? []);
  }, [applyEmblemsToLoadout, resultPicks]);

  const applyAdvancedColorDefaults = useCallback(
    (targetPool: typeof pool) => {
      const defaults = deriveAdvancedColorUiDefaults(pokemon, targetPool, allEmblems);
      setColorMode(defaults.colorMode);
      setActiveColors(new Set(defaults.activeColors));
      setColorCounts(
        Object.fromEntries(
          POSITIVE_COLORS.map((c) => [c, defaults.colorCounts.get(c) ?? 0]),
        ) as Record<EmblemColor, number>,
      );
    },
    [pokemon],
  );

  /** Switch owned/full pool; on full dataset, re-derive color UI (exact when feasible). */
  const handleSetUseOwned = useCallback(
    (nextUseOwned: boolean) => {
      setUseOwned(nextUseOwned);
      if (!nextUseOwned) {
        const fullPool = buildPool(
          allEmblems,
          { useOwned: false, mixedGrades, allowedGrades },
          owned,
        );
        applyAdvancedColorDefaults(fullPool);
      }
    },
    [mixedGrades, allowedGrades, owned, applyAdvancedColorDefaults],
  );

  const applyAdvancedProtectDefaults = useCallback(
    (level: number) => {
      if (pokemon) {
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
    },
    [pokemon],
  );

  const syncAdvancedFromPokemon = useCallback(() => {
    setCustomWeights({});
    applyAdvancedProtectDefaults(optimizeLevel);
    applyAdvancedColorDefaults(pool);
  }, [optimizeLevel, pool, applyAdvancedProtectDefaults, applyAdvancedColorDefaults]);

  const syncAdvancedFromBasic = useCallback(() => {
    const grades = new Set(DEFAULT_ALLOWED_GRADES);
    setUseOwned(BASIC_POOL_DEFAULTS.useOwned);
    setMixedGrades(BASIC_POOL_DEFAULTS.mixedGrades);
    setAllowedGrades(grades);
    setMode("maximize");
    setColorBonuses(true);
    setPokemonAwareScoring(true);
    setCustomWeights({});
    setExactCap(DEFAULT_EXACT_CAP);

    applyAdvancedProtectDefaults(optimizeLevel);

    const defaultPool = buildPool(
      allEmblems,
      {
        useOwned: BASIC_POOL_DEFAULTS.useOwned,
        mixedGrades: BASIC_POOL_DEFAULTS.mixedGrades,
        allowedGrades: grades,
      },
      owned,
    );
    applyAdvancedColorDefaults(defaultPool);
  }, [optimizeLevel, owned, applyAdvancedProtectDefaults, applyAdvancedColorDefaults]);

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

  const handleBasicSearch = useCallback(async () => {
    if (!pokemon || !basicObjective || basicPool.length < SLOTS) return;
    const {
      forceHeuristic,
      heuristicEffort,
      exactCap: basicExactCap,
    } = resolveBasicSearchParams(basicEffort, basicColorResolution);
    const { options } = buildPresetSearchOptions({
      pokemon,
      level: optimizeLevel,
      pool: basicPool,
      emblems: allEmblems,
      pokemonList,
      forceHeuristic,
      exactCap: basicExactCap,
      enumerateGradeVariants: BASIC_POOL_DEFAULTS.mixedGrades,
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

  const handleAdvancedSearch = useCallback(async () => {
    if (advancedNotEnoughEmblems) return;
    await run(
      pool,
      advancedSearchOptions,
      setBonuses,
      effort,
      searchSettingsKey,
      effectiveResultCount,
    );
  }, [
    advancedNotEnoughEmblems,
    pool,
    advancedSearchOptions,
    effort,
    run,
    searchSettingsKey,
    effectiveResultCount,
  ]);

  const hasResult =
    (searchState.status === "done" || searchState.status === "cancelled") && !!resultPicks?.length;

  const historyCount = searchState.history.length;
  const historyIndex = searchState.historyIndex >= 0 ? searchState.historyIndex : 0;

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
      const baseline = computeEffectiveStats(
        pokemon,
        optimizeLevel,
        emptyLoadout,
        items,
        itemGrades,
        ctx,
      );
      const withEmblems = computeEffectiveStats(
        pokemon,
        optimizeLevel,
        emblemLoadout,
        items,
        itemGrades,
        ctx,
      );

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

  const shared: OptimizerSharedProps = {
    pokemon,
    searchState,
    resultPicks,
    effectiveDelta,
    hasResult,
    historyCount,
    historyIndex,
    goHistory,
    clearResult,
    handleApplyEmblems,
    applied,
    optimizeLevel,
    setOptimizeLevel,
    cancel,
    toast,
    searchWillRunExact,
    resultCount,
    setResultCount,
    allowedGrades,
    setAllowedGrades,
  };

  const basic: OptimizerBasicProps = {
    basicUseOwned,
    setBasicUseOwned,
    basicEffort,
    setBasicEffort,
    basicPool,
    basicNotEnoughEmblems,
    resolvedBasicEffort,
    basicExactColorFeasible,
    basicExactEnumFeasible,
    basicWillRunExactSearch,
    handleBasicSearch,
  };

  const advanced: OptimizerAdvancedProps = {
    pool,
    useOwned,
    setUseOwned: handleSetUseOwned,
    mixedGrades,
    setMixedGrades,
    enumerateGradeVariants,
    mode,
    setMode,
    effort,
    setEffort,
    exactCap,
    setExactCap,
    colorMode,
    setColorMode,
    activeColors,
    setActiveColors,
    colorCounts,
    setColorCounts,
    colorBonuses,
    setColorBonuses,
    pokemonAwareScoring,
    setPokemonAwareScoring,
    customWeights,
    setCustomWeights,
    targetValues,
    setTargetValues,
    targetActive,
    setTargetActive,
    floorValues,
    setFloorValues,
    floorActive,
    setFloorActive,
    advancedNotEnoughEmblems,
    buildCount,
    candidateCount,
    poolDistinctNames,
    colorConstraints,
    colorConstraintValid,
    constrainedBuildCount,
    exactEnumerationCount,
    willRunExact,
    colorCapacities,
    totalColorConstrained,
    colorBonusPreviews,
    emblemPresetResolution,
    priorities,
    flatStatPredictionByStat,
    handleAdvancedSearch,
    syncAdvancedFromBasic,
  };

  return { shared, basic, advanced };
}
