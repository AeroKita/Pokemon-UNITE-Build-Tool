import type { BasicEffort } from "../../engine/emblemSearch/searchPresets";
import type { EmblemGrade } from "../../types";
import type { ViewMode } from "../../state/store";
import { Segmented } from "../Segmented";
import { ResultCards } from "./ResultCards";
import { SLOTS, type OptimizerBasicProps, type OptimizerSharedProps } from "./shared";
import { VariationsControl } from "./VariationsControl";

export function BasicOptimizer({
  shared,
  basic,
  onNavigate,
  setViewMode,
}: {
  shared: OptimizerSharedProps;
  basic: OptimizerBasicProps;
  onNavigate?: (page: string) => void;
  setViewMode: (mode: ViewMode) => void;
}) {
  const {
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
    searchWillRunExact,
    resultCount,
    setResultCount,
    allowedGrades,
    setAllowedGrades,
  } = shared;

  const {
    basicUseOwned,
    setBasicUseOwned,
    setBasicEffort,
    basicPool,
    basicNotEnoughEmblems,
    resolvedBasicEffort,
    basicExactColorFeasible,
    basicExactEnumFeasible,
    basicWillRunExactSearch,
    handleBasicSearch,
  } = basic;

  return (
    <>
      {!pokemon && (
        <div className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-muted shadow-sm">
          Tap the Pokémon icon at the top to choose who to optimize.
        </div>
      )}

      {pokemon && basicNotEnoughEmblems && basicUseOwned && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <p className="font-medium text-amber-700 dark:text-amber-300">
            You own only {basicPool.length} emblem{basicPool.length !== 1 ? "s" : ""} — need {SLOTS}{" "}
            for a full build.
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
            Only {basicPool.length} emblem candidate{basicPool.length !== 1 ? "s" : ""} in pool —
            need {SLOTS} for a full build.
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

      {pokemon && (
        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface px-4 py-3 shadow-sm">
          <div className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2">
            <span className="shrink-0 text-xs text-muted">Optimize for level</span>
            <input
              type="range"
              min={1}
              max={15}
              step={1}
              value={optimizeLevel}
              onChange={(e) => setOptimizeLevel(parseInt(e.target.value))}
              className="flex-1 accent-accent"
            />
            <span className="w-6 shrink-0 text-right font-mono text-sm font-semibold text-ink">
              {optimizeLevel}
            </span>
          </div>

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
                        if (on) next.delete(g);
                        else next.add(g);
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
          </div>

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
              labels={{
                quick: "Fast",
                normal: "Balanced",
                thorough: "Thorough",
                exact: "Exact",
              }}
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
          onClearResults={clearResult}
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
  );
}
