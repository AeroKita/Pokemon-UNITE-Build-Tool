import { formatBuildCount } from "../../../engine/emblemSearch/pool";
import type { EmblemCandidate } from "../../../engine/emblemSearch/types";
import type { EmblemColor, EmblemGrade } from "../../../types";
import { CollapsibleCard } from "../../CollapsibleCard";
import { Segmented } from "../../Segmented";
import type { ColorMode } from "../shared";

export interface SearchPoolCardProps {
  pool: EmblemCandidate[];
  useOwned: boolean;
  setUseOwned: (owned: boolean) => void;
  mixedGrades: boolean;
  setMixedGrades: (mixed: boolean) => void;
  allowedGrades: Set<EmblemGrade>;
  setAllowedGrades: (grades: Set<EmblemGrade>) => void;
  buildCount: bigint;
  candidateCount: number;
  poolDistinctNames: number;
  colorMode: ColorMode;
  colorConstraints: Map<EmblemColor, number> | null;
  colorConstraintValid: boolean;
  constrainedBuildCount: bigint | null;
  willRunExact: boolean;
}

export function SearchPoolCard({
  pool,
  useOwned,
  setUseOwned,
  mixedGrades,
  setMixedGrades,
  allowedGrades,
  setAllowedGrades,
  buildCount,
  candidateCount,
  poolDistinctNames,
  colorMode,
  colorConstraints,
  colorConstraintValid,
  constrainedBuildCount,
  willRunExact,
}: SearchPoolCardProps) {
  return (
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
        {(() => {
          const colorExact = colorMode === "exact" && colorConstraints && colorConstraintValid;
          const matchesZero = colorExact && constrainedBuildCount === 0n;
          return (
            <div className="flex flex-col gap-2 rounded-lg bg-white/10 px-3 py-2.5 text-xs">
              <div className="flex items-baseline justify-between gap-3">
                <span className="shrink-0 text-muted">
                  {colorExact ? "Matching builds" : "Possible builds"}
                </span>
                <span
                  className={`min-w-0 text-right font-mono font-semibold ${matchesZero ? "text-neg" : "text-ink"}`}
                >
                  {colorExact ? (
                    constrainedBuildCount === null ? (
                      "Many"
                    ) : constrainedBuildCount === 0n ? (
                      "None match"
                    ) : (
                      <>
                        {formatBuildCount(constrainedBuildCount)}{" "}
                        <span className="font-sans font-normal text-faint">
                          of {formatBuildCount(buildCount)}
                        </span>
                      </>
                    )
                  ) : (
                    formatBuildCount(buildCount)
                  )}
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
                        : `${formatBuildCount(constrainedBuildCount)} builds exceeds the cap — Smart search finds a strong result`
                    }
                  >
                    {willRunExact ? "⚡ Exact" : "Smart search"}
                  </span>
                </div>
              )}

              {matchesZero && (
                <p className="text-xs text-neg">
                  No builds match these exact color counts — adjust targets below or expand the
                  pool.
                </p>
              )}
            </div>
          );
        })()}
      </div>
    </CollapsibleCard>
  );
}
