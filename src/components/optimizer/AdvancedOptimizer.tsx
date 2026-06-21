import type { ViewMode } from "../../state/store";
import { ResultCards } from "./ResultCards";
import { ColorCard } from "./advanced/ColorCard";
import { ModeEffortCard } from "./advanced/ModeEffortCard";
import { SearchPoolCard } from "./advanced/SearchPoolCard";
import { StatMinimumsCard } from "./advanced/StatMinimumsCard";
import { StatPrioritiesCard } from "./advanced/StatPrioritiesCard";
import { StatTargetsCard } from "./advanced/StatTargetsCard";
import {
  PHASE_LABEL,
  SLOTS,
  type OptimizerAdvancedProps,
  type OptimizerSharedProps,
} from "./shared";

export function AdvancedOptimizer({
  shared,
  advanced,
  onNavigate,
}: {
  shared: OptimizerSharedProps;
  advanced: OptimizerAdvancedProps;
  onNavigate?: (page: string) => void;
  setViewMode: (mode: ViewMode) => void;
}) {
  const {
    pokemon,
    searchState,
    resultPicks,
    hasResult,
    historyCount,
    historyIndex,
    goHistory,
    clearResult,
    handleApplyEmblems,
    applied,
    optimizeLevel,
    setOptimizeLevel,
    searchWillRunExact,
    resultCount,
    setResultCount,
    allowedGrades,
    setAllowedGrades,
  } = shared;

  const {
    pool,
    useOwned,
    setUseOwned,
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
  } = advanced;

  return (
    <>
      {!pokemon && (
        <div className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-muted shadow-sm">
          Tap the Pokémon icon at the top to choose who to optimize.
        </div>
      )}

      {pokemon && advancedNotEnoughEmblems && useOwned && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <p className="font-medium text-amber-700 dark:text-amber-300">
            You own only {pool.length} emblem{pool.length !== 1 ? "s" : ""} — need {SLOTS} for a
            full build.
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
            Only {pool.length} emblem candidate{pool.length !== 1 ? "s" : ""} in pool — need {SLOTS}{" "}
            for a full build.
          </p>
          <p className="mt-1 text-xs text-muted">Enable more grades above.</p>
        </div>
      )}

      <SearchPoolCard
        pool={pool}
        useOwned={useOwned}
        setUseOwned={setUseOwned}
        mixedGrades={mixedGrades}
        setMixedGrades={setMixedGrades}
        enumerateGradeVariants={enumerateGradeVariants}
        allowedGrades={allowedGrades}
        setAllowedGrades={setAllowedGrades}
        buildCount={buildCount}
        candidateCount={candidateCount}
        poolDistinctNames={poolDistinctNames}
        colorMode={colorMode}
        colorConstraints={colorConstraints}
        colorConstraintValid={colorConstraintValid}
        constrainedBuildCount={constrainedBuildCount}
        exactEnumerationCount={exactEnumerationCount}
        willRunExact={willRunExact}
      />

      <ModeEffortCard
        mode={mode}
        setMode={setMode}
        effort={effort}
        setEffort={setEffort}
        exactCap={exactCap}
        setExactCap={setExactCap}
        colorMode={colorMode}
        willRunExact={willRunExact}
        resultCount={resultCount}
        setResultCount={setResultCount}
        searchWillRunExact={searchWillRunExact}
        optimizeLevel={optimizeLevel}
        setOptimizeLevel={setOptimizeLevel}
        colorBonuses={colorBonuses}
        setColorBonuses={setColorBonuses}
        pokemonAwareScoring={pokemonAwareScoring}
        setPokemonAwareScoring={setPokemonAwareScoring}
        pokemon={pokemon}
      />

      <ColorCard
        colorMode={colorMode}
        setColorMode={setColorMode}
        activeColors={activeColors}
        setActiveColors={setActiveColors}
        colorCounts={colorCounts}
        setColorCounts={setColorCounts}
        colorCapacities={colorCapacities}
        colorConstraintValid={colorConstraintValid}
        totalColorConstrained={totalColorConstrained}
        constrainedBuildCount={constrainedBuildCount}
        exactEnumerationCount={exactEnumerationCount}
        willRunExact={willRunExact}
        buildCount={buildCount}
        colorBonusPreviews={colorBonusPreviews}
        pokemon={pokemon}
        optimizeLevel={optimizeLevel}
        emblemPresetResolution={emblemPresetResolution}
      />

      {mode === "maximize" && (
        <StatPrioritiesCard
          priorities={priorities}
          setCustomWeights={setCustomWeights}
          flatStatPredictionByStat={flatStatPredictionByStat}
          flatStatEstimatesUnavailable={advancedNotEnoughEmblems}
          poolCandidateCount={candidateCount}
          useOwned={useOwned}
          pokemon={pokemon}
          emblemPresetResolution={emblemPresetResolution}
        />
      )}

      {mode === "target" && (
        <StatTargetsCard
          targetValues={targetValues}
          setTargetValues={setTargetValues}
          targetActive={targetActive}
          setTargetActive={setTargetActive}
        />
      )}

      <StatMinimumsCard
        floorValues={floorValues}
        setFloorValues={setFloorValues}
        floorActive={floorActive}
        setFloorActive={setFloorActive}
        pokemon={pokemon}
        emblemPresetResolution={emblemPresetResolution}
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleAdvancedSearch}
          disabled={
            !pokemon ||
            advancedNotEnoughEmblems ||
            (colorMode === "exact" && !colorConstraintValid) ||
            searchState.status === "running"
          }
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
            {" · "}
            {searchState.result.candidates.toLocaleString()} evaluated
            {" · "}
            {(searchState.result.totalMs / 1000).toFixed(1)}s
          </span>
        )}
        {searchState.status === "error" && (
          <span className="text-xs text-neg">{searchState.errorMsg}</span>
        )}
      </div>

      {hasResult && resultPicks && (
        <ResultCards
          picks={resultPicks}
          searchResult={searchState.result}
          pokemon={pokemon}
          searchLevel={optimizeLevel}
          applied={applied}
          historyCount={historyCount}
          historyIndex={historyIndex}
          onGoHistory={goHistory}
          onClearResults={clearResult}
          onApplyEmblems={handleApplyEmblems}
        />
      )}

      {searchState.status === "done" && !searchState.result && (
        <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-faint">
          No valid loadout found. Try expanding the pool or relaxing constraints.
        </p>
      )}
    </>
  );
}
