import {
  BONUS_STAT_LABELS,
  concreteBonusDelta,
  type ColorBonusPreviewItem,
} from "../../../engine/emblemSearch/colorBonusPreview";
import { formatBuildCount, matchingBuildDisplayCount } from "../../../engine/emblemSearch/pool";
import type { ResolvedEmblemPreset } from "../../../engine/emblemSearch/optimizerPresets";
import type { EmblemColor } from "../../../types";
import { CollapsibleCard } from "../../CollapsibleCard";
import { Segmented } from "../../Segmented";
import { ColorCountField } from "../ColorCountField";
import {
  ColorDot,
  POSITIVE_COLORS,
  presetAutofillIntro,
  SLOTS,
  type ColorMode,
  type OptimizerPokemon,
} from "../shared";

export interface ColorCardProps {
  colorMode: ColorMode;
  setColorMode: (mode: ColorMode) => void;
  activeColors: Set<EmblemColor>;
  setActiveColors: (colors: Set<EmblemColor>) => void;
  colorCounts: Record<EmblemColor, number>;
  setColorCounts: (
    counts:
      | Record<EmblemColor, number>
      | ((prev: Record<EmblemColor, number>) => Record<EmblemColor, number>),
  ) => void;
  colorCapacities: Map<EmblemColor, number>;
  colorConstraintValid: boolean;
  totalColorConstrained: number;
  constrainedBuildCount: bigint | null;
  exactEnumerationCount: bigint | null;
  willRunExact: boolean;
  buildCount: bigint;
  colorBonusPreviews: ColorBonusPreviewItem[];
  pokemon: OptimizerPokemon;
  optimizeLevel: number;
  emblemPresetResolution: ResolvedEmblemPreset | null;
}

export function ColorCard({
  colorMode,
  setColorMode,
  activeColors,
  setActiveColors,
  colorCounts,
  setColorCounts,
  colorCapacities,
  colorConstraintValid,
  totalColorConstrained,
  constrainedBuildCount,
  exactEnumerationCount,
  willRunExact,
  buildCount,
  colorBonusPreviews,
  pokemon,
  optimizeLevel,
  emblemPresetResolution,
}: ColorCardProps) {
  return (
    <CollapsibleCard title="Color" persistKey="optimizer-colors" defaultOpen={false}>
      <div className="flex flex-col gap-3">
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

        {colorMode === "weighted" && (
          <p className="text-xs text-muted">
            Steers the search toward higher set-bonus tiers without rejecting builds. Set-bonus
            scoring is always on in this mode. Use <strong>Exact</strong> to require specific
            per-color counts.
          </p>
        )}

        {colorMode !== "off" && (
          <>
            {pokemon && (
              <p className="text-xs text-faint">
                {presetAutofillIntro(pokemon.displayName, emblemPresetResolution)} when you reset or
                change Pokémon.
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
                      if (e.target.checked) next.add(col);
                      else next.delete(col);
                      setActiveColors(next);
                    }}
                    className="accent-accent"
                  />
                  <ColorDot color={col} />
                  <span className="flex-1 capitalize">{col}</span>
                  <div
                    className={`shrink-0 ${activeColors.has(col) ? "" : "invisible"}`}
                    aria-hidden={!activeColors.has(col)}
                  >
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
                {totalColorConstrained > SLOTS &&
                  " (sum > 10 is valid — dual-color emblems count toward both colors)"}
              </p>
            )}
            {colorMode === "weighted" && activeColors.size > 0 && (
              <p className="text-xs text-faint">
                Counts are for reference — scoring uses set-bonus incentive, not hard constraints.
              </p>
            )}

            {colorBonusPreviews.length > 0 && (
              <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-white/5 p-2">
                <span className="text-[10px] font-medium uppercase tracking-wide text-faint">
                  Set bonus preview
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {colorBonusPreviews.map((b) => {
                    const pctStr = `+${(b.percent * 100).toFixed(0)}%`;
                    const statLabel = BONUS_STAT_LABELS[b.stat] ?? String(b.stat);
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
                        {deltaStr && <span className="text-muted">{deltaStr}</span>}
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
              <p className="text-xs text-faint">No set-bonus tier reached at these counts.</p>
            )}

            {colorMode === "exact" &&
              colorConstraintValid &&
              (() => {
                const matchingBuildCount = matchingBuildDisplayCount(
                  exactEnumerationCount,
                  constrainedBuildCount,
                );
                return (
                  <div className="text-xs text-muted">
                    {matchingBuildCount === null ? (
                      "Matching builds: too many to count."
                    ) : matchingBuildCount === 0n ? (
                      <span className="text-neg">
                        Matching builds: 0 — no combination hits these exact counts.
                      </span>
                    ) : (
                      <>
                        Matching builds:{" "}
                        <span className="font-medium text-ink">
                          {formatBuildCount(matchingBuildCount)}
                        </span>{" "}
                        {willRunExact ? (
                          <span className="text-pos">· Exact search</span>
                        ) : (
                          <span className="text-muted">· Smart search (above cap)</span>
                        )}
                      </>
                    )}
                  </div>
                );
              })()}
            {colorMode === "weighted" && activeColors.size > 0 && (
              <div className="text-xs text-muted">
                Pool size:{" "}
                <span className="font-medium text-ink">{formatBuildCount(buildCount)}</span> builds
                — colors affect scoring, not which builds are allowed.
              </div>
            )}
          </>
        )}
      </div>
    </CollapsibleCard>
  );
}
