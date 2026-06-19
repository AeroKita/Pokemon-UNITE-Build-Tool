import { DEFAULT_EXACT_CAP } from "../../../engine/emblemSearch/orchestrator";
import type { SearchMode } from "../../../engine/emblemSearch/types";
import { CollapsibleCard } from "../../CollapsibleCard";
import { Segmented } from "../../Segmented";
import { VariationsControl } from "../VariationsControl";
import type { ColorMode, Effort, OptimizerPokemon } from "../shared";

export interface ModeEffortCardProps {
  mode: SearchMode;
  setMode: (mode: SearchMode) => void;
  effort: Effort;
  setEffort: (effort: Effort) => void;
  exactCap: number;
  setExactCap: (cap: number) => void;
  colorMode: ColorMode;
  willRunExact: boolean;
  resultCount: number;
  setResultCount: (n: number) => void;
  searchWillRunExact: boolean;
  optimizeLevel: number;
  setOptimizeLevel: (level: number) => void;
  colorBonuses: boolean;
  setColorBonuses: (on: boolean) => void;
  pokemonAwareScoring: boolean;
  setPokemonAwareScoring: (on: boolean) => void;
  pokemon: OptimizerPokemon;
}

export function ModeEffortCard({
  mode,
  setMode,
  effort,
  setEffort,
  exactCap,
  setExactCap,
  colorMode,
  willRunExact,
  resultCount,
  setResultCount,
  searchWillRunExact,
  optimizeLevel,
  setOptimizeLevel,
  colorBonuses,
  setColorBonuses,
  pokemonAwareScoring,
  setPokemonAwareScoring,
  pokemon,
}: ModeEffortCardProps) {
  return (
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
                  Reset to 1B
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
                  const n = e.target.valueAsNumber;
                  if (Number.isFinite(n) && n >= 1) {
                    setExactCap(Math.floor(n));
                  }
                }}
                className="w-40 rounded bg-surface px-2 py-1 font-mono text-xs text-ink ring-1 ring-line focus:outline-none focus:ring-accent"
              />
              <span className="text-xs text-faint">
                {exactCap.toLocaleString()} —{" "}
                {colorMode === "exact" && willRunExact
                  ? "Exact"
                  : colorMode === "exact"
                    ? "Smart search"
                    : ""}
              </span>
            </div>
            <p className="text-xs text-faint">
              Below this cap, every valid build is checked (guaranteed best). Above it, smart search
              still finds a strong result. Default: {DEFAULT_EXACT_CAP.toLocaleString()}.
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
            <label
              className={`flex cursor-pointer items-center gap-2 text-sm ${!pokemon ? "opacity-50" : ""}`}
            >
              <input
                type="checkbox"
                checked={pokemonAwareScoring && !!pokemon}
                onChange={(e) => setPokemonAwareScoring(e.target.checked)}
                disabled={!pokemon}
                className="accent-accent"
              />
              <span>
                Pokémon-aware scoring
                {pokemon ? ` — ${pokemon.displayName} Lv.${optimizeLevel}` : " (select a Pokémon)"}
              </span>
            </label>
          </div>
        )}
      </div>
    </CollapsibleCard>
  );
}
