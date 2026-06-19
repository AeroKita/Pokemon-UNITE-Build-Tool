import { emblemById } from "../../data/gameData";
import type { EmblemGrade, StatBlock } from "../../types";
import { CollapsibleCard } from "../CollapsibleCard";
import { EmblemSetSummary } from "../EmblemSetSummary";
import { Tooltip } from "../Tooltip";
import { emblemTip } from "../tips";
import { EMBLEM_COLOR_HEX, GRADE_LETTER } from "../../ui/colors";
import { emblemIconForGrade } from "../../ui/emblemIcon";
import { asset } from "../../ui/asset";
import {
  fmtDelta,
  STAT_LABELS,
  type AppliedState,
  type EffectiveDelta,
  type OptimizerPokemon,
} from "./shared";

export interface ResultPanelProps {
  picks: { emblemId: string; grade: EmblemGrade }[];
  effectiveDelta: EffectiveDelta | null;
  searchResult: { phase: string; candidates: number; totalMs: number; error?: number } | null;
  pokemon: OptimizerPokemon;
  optimizeLevel: number;
  pokemonAwareScoring: boolean;
  applied: AppliedState;
  historyCount: number;
  historyIndex: number;
  onGoHistory: (delta: number) => void;
  onClearResults: () => void;
  onApplyEmblems: () => void;
}

export function ResultCards({
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
  onClearResults,
  onApplyEmblems,
}: ResultPanelProps) {
  return (
    <CollapsibleCard
      title="Results"
      persistKey="optimizer-results"
      tone="indigo"
      center={
        <button
          type="button"
          onClick={onClearResults}
          aria-label="Clear Results"
          className="min-h-11 rounded-lg border border-line px-4 py-2 text-sm font-medium text-muted transition hover:bg-neg/10 hover:text-neg active:scale-[0.98]"
        >
          Clear Results
        </button>
      }
    >
      <div className="flex flex-col gap-4">
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

        {historyCount > 1 && historyIndex < historyCount - 1 && (
          <p className="text-center text-xs text-accent-ink">New results — tap › to view</p>
        )}

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
                  <div
                    key={stat}
                    className="flex items-baseline justify-between border-b border-line-soft py-1"
                  >
                    <dt className="text-sm text-muted">{STAT_LABELS[stat]}</dt>
                    <dd
                      className={`font-mono text-sm font-semibold ${delta >= 0 ? "text-pos" : "text-neg"}`}
                    >
                      {fmtDelta(stat, delta)}
                    </dd>
                  </div>
                ))}
            </dl>
          </div>
        )}

        {searchResult?.error !== undefined && (
          <p className="text-xs text-muted">
            Target error:{" "}
            <span className={`font-mono ${searchResult.error < 0.01 ? "text-pos" : "text-neg"}`}>
              {searchResult.error.toFixed(3)}
            </span>
            {searchResult.error < 0.01 && " (exact)"}
          </p>
        )}

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
