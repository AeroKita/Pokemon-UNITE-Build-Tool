import type { FlatStatPrediction } from "../../../engine/emblemSearch/predictStats";
import type { ResolvedEmblemPreset } from "../../../engine/emblemSearch/optimizerPresets";
import type { StatBlock } from "../../../types";
import { CollapsibleCard } from "../../CollapsibleCard";
import { PriorityFlatEstimate } from "../PriorityFlatEstimate";
import {
  flatStatEstimateUnavailableMessage,
  presetAutofillIntro,
  SLOTS,
  STAT_LABELS,
  STAT_ROW_GRID,
  WEIGHT_UI_MAX,
  type OptimizerPokemon,
} from "../shared";

export interface StatPrioritiesCardProps {
  priorities: Record<string, number>;
  setCustomWeights: (
    weights: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>),
  ) => void;
  flatStatPredictionByStat: Map<keyof StatBlock, FlatStatPrediction>;
  flatStatEstimatesUnavailable: boolean;
  poolCandidateCount: number;
  useOwned: boolean;
  pokemon: OptimizerPokemon;
  emblemPresetResolution: ResolvedEmblemPreset | null;
}

export function StatPrioritiesCard({
  priorities,
  setCustomWeights,
  flatStatPredictionByStat,
  flatStatEstimatesUnavailable,
  poolCandidateCount,
  useOwned,
  pokemon,
  emblemPresetResolution,
}: StatPrioritiesCardProps) {
  return (
    <CollapsibleCard title="Stat Priorities" persistKey="optimizer-priorities">
      <div className="flex flex-col gap-2">
        <p className="text-xs text-faint">
          {pokemon
            ? flatStatEstimatesUnavailable
              ? `${presetAutofillIntro(pokemon.displayName, emblemPresetResolution)}. Adjust sliders to reprioritize — approx. flat stats appear below each one once your pool has at least ${SLOTS} emblems.`
              : `${presetAutofillIntro(pokemon.displayName, emblemPresetResolution)}. Adjust sliders to reprioritize — predicted flat stats update below each one.`
            : "Select a Pokémon to auto-populate weights."}
        </p>
        {flatStatEstimatesUnavailable && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            {flatStatEstimateUnavailableMessage(poolCandidateCount, useOwned)}
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Object.entries(STAT_LABELS).map(([stat, label]) => {
            const w = priorities[stat as keyof typeof priorities] ?? 0;
            const uiValue = Math.min(1, w / WEIGHT_UI_MAX);
            const pred = flatStatPredictionByStat.get(stat as keyof StatBlock);
            return (
              <div key={stat} className={`${STAT_ROW_GRID} text-xs`}>
                <span className="text-muted">{label}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
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
                  <PriorityFlatEstimate
                    stat={stat as keyof StatBlock}
                    pred={pred}
                    weight={w}
                    poolTooSmall={flatStatEstimatesUnavailable}
                    poolCandidateCount={poolCandidateCount}
                    useOwned={useOwned}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {!flatStatEstimatesUnavailable && (
          <p className="text-xs text-faint">
            Estimated flat emblem totals for the current priorities on this pool.
          </p>
        )}
        <button
          onClick={() => setCustomWeights({})}
          className="self-start text-xs text-muted underline hover:text-ink"
        >
          Reset to Pokémon defaults
        </button>
      </div>
    </CollapsibleCard>
  );
}
