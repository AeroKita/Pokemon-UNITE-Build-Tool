import { useEffect, useMemo, useState } from "react";
import { emblemById, heldItemById, setBonuses } from "../../data/gameData";
import { deriveEmblemLoadoutImpact } from "../../engine/emblemSearch/pokemonScore";
import type { EmblemGrade, HeldItem } from "../../types";
import { useStore } from "../../state/store";
import { STAT_ROWS, formatExactDelta, formatStat } from "../../ui/format";
import { CollapsibleCard } from "../CollapsibleCard";
import { EmblemSetSummary } from "../EmblemSetSummary";
import { Tooltip } from "../Tooltip";
import { emblemTip } from "../tips";
import { EMBLEM_COLOR_HEX, GRADE_LETTER } from "../../ui/colors";
import { emblemIconForGrade } from "../../ui/emblemIcon";
import { asset } from "../../ui/asset";
import { type AppliedState, type EffectiveDelta, type OptimizerPokemon } from "./shared";

export interface ResultPanelProps {
  picks: { emblemId: string; grade: EmblemGrade }[];
  searchResult: { phase: string; candidates: number; totalMs: number; error?: number } | null;
  pokemon: OptimizerPokemon;
  /** Level the search was run at — preview slider defaults here. */
  searchLevel: number;
  applied: AppliedState;
  historyCount: number;
  historyIndex: number;
  onGoHistory: (delta: number) => void;
  onClearResults: () => void;
  onApplyEmblems: () => void;
}

function picksKey(picks: { emblemId: string; grade: EmblemGrade }[]): string {
  return picks.map((p) => `${p.emblemId}:${p.grade}`).join(",");
}

function resolveHeldItems(
  heldItemIds: (string | null)[],
  heldSlotGrades: [number, number, number],
): { items: HeldItem[]; itemGrades: number[] } {
  const items: HeldItem[] = [];
  const itemGrades: number[] = [];
  for (let i = 0; i < 3; i++) {
    const id = heldItemIds[i];
    if (!id) continue;
    const item = heldItemById.get(id);
    if (!item) continue;
    items.push(item);
    itemGrades.push(heldSlotGrades[i] ?? 40);
  }
  return { items, itemGrades };
}

export function ResultCards({
  picks,
  searchResult,
  pokemon,
  searchLevel,
  applied,
  historyCount,
  historyIndex,
  onGoHistory,
  onClearResults,
  onApplyEmblems,
}: ResultPanelProps) {
  const { loadout, heldSlotGrades } = useStore();
  const [previewLevel, setPreviewLevel] = useState(searchLevel);
  const buildKey = useMemo(() => picksKey(picks), [picks]);

  useEffect(() => {
    setPreviewLevel(searchLevel);
  }, [searchLevel, buildKey]);

  const effectiveDelta = useMemo((): EffectiveDelta | null => {
    if (!picks.length || !pokemon) return null;
    const { items, itemGrades } = resolveHeldItems(loadout.heldItemIds, heldSlotGrades);
    try {
      const impact = deriveEmblemLoadoutImpact(
        pokemon,
        previewLevel,
        picks,
        items,
        itemGrades,
        setBonuses,
      );
      if (!impact || Object.keys(impact.emblemDelta).length === 0) return null;
      return {
        effective: impact.effective,
        delta: impact.emblemDelta,
        emblemLoadout: impact.emblemLoadout,
        oocMoveSpeed: impact.oocMoveSpeed,
      };
    } catch {
      return null;
    }
  }, [picks, pokemon, previewLevel, loadout.heldItemIds, heldSlotGrades]);

  const previewingOtherLevel = previewLevel !== searchLevel;

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

        {effectiveDelta && pokemon && (
          <div className="rounded-xl border border-line-soft bg-surface/60 p-3 ring-1 ring-line/40">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-faint">
                  Effective stats
                </p>
                <p className="mt-0.5 truncate text-sm text-muted">{pokemon.displayName}</p>
              </div>
              <span className="shrink-0 rounded-md bg-grade-badge px-2.5 py-0.5 font-mono text-sm font-bold text-white tabular-nums">
                Lv {previewLevel}
              </span>
            </div>

            <div className="py-2">
              <input
                type="range"
                min={1}
                max={15}
                step={1}
                value={previewLevel}
                onChange={(e) => setPreviewLevel(Number(e.target.value))}
                aria-label="Preview level"
                className="block w-full accent-accent"
              />
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint">
              {previewingOtherLevel ? (
                <>
                  <span>
                    Previewing Lv {previewLevel} · search used Lv {searchLevel}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPreviewLevel(searchLevel)}
                    className="font-medium text-accent-ink underline decoration-accent-ink/40 underline-offset-2 hover:decoration-accent-ink"
                  >
                    Reset
                  </button>
                </>
              ) : (
                <span>Search level — slide to compare other levels</span>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-0 sm:grid-cols-3">
              {STAT_ROWS.map((row) => {
                const eff = effectiveDelta.effective[row.key];
                const delta = effectiveDelta.delta[row.key];
                return (
                  <div
                    key={row.key}
                    className="flex items-baseline justify-between border-b border-line-soft py-1"
                  >
                    <dt className="text-sm text-muted">{row.label}</dt>
                    <dd className="text-right font-mono text-sm font-semibold text-ink">
                      {formatStat(eff, row.kind)}
                      {delta !== undefined && (
                        <span
                          className={`ml-1 text-xs font-normal ${delta >= 0 ? "text-pos" : "text-neg"}`}
                        >
                          ({formatExactDelta(delta, row.kind)})
                        </span>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>

            <p className="mt-2 text-xs text-faint">
              Out-of-combat move speed:{" "}
              <span className="font-mono">{effectiveDelta.oocMoveSpeed?.toLocaleString()}</span>
              {effectiveDelta.oocMoveSpeed != null &&
                effectiveDelta.oocMoveSpeed > effectiveDelta.effective.moveSpeed && (
                  <span className="ml-1 text-pos">
                    (
                    {formatExactDelta(
                      effectiveDelta.oocMoveSpeed - effectiveDelta.effective.moveSpeed,
                      "int",
                    )}
                    )
                  </span>
                )}
              {effectiveDelta.emblemLoadout.activeSetBonuses.length > 0 && (
                <>
                  {" "}
                  · Set bonuses:{" "}
                  {effectiveDelta.emblemLoadout.activeSetBonuses
                    .map((b) => `${b.color} +${(b.bonusPercent * 100).toFixed(0)}%`)
                    .join(", ")}
                </>
              )}
            </p>
            {effectiveDelta.emblemLoadout.activeSetBonuses.some((b) => b.color === "yellow") && (
              <p className="mt-1 text-xs text-faint">
                Yellow set bonus applies only out of combat.
              </p>
            )}
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
