import { useMemo } from "react";
import { useStore } from "../state/store";
import { deriveBuild } from "../engine/derive";
import { effectiveHp } from "../engine/formulas";
import { boostAvailableAtLevel, boostPointsAtLevel } from "../engine/effects";
import { STAT_ROWS, formatStat, formatExactDelta } from "../ui/format";
import { CollapsibleCard } from "./CollapsibleCard";

export function StatPanel() {
  const { loadout, dispatch, expert, heldSlotGrades } = useStore();
  const derived = useMemo(() => deriveBuild(loadout, true, heldSlotGrades), [loadout, heldSlotGrades]);
  const { pokemon, effective, base, attackSpeed, oocMoveSpeed, availableBoosts, emblemLoadout, buffedStats } = derived;

  if (!pokemon || !effective || !base || !attackSpeed) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 text-muted">
        Select a Pokémon to see live stats.
      </div>
    );
  }

  const activeIds = new Set(loadout.activeBoostIds);
  const offenseStat =
    pokemon.attackType === "special" ? effective.spAttack
    : pokemon.attackType === "hybrid" ? Math.max(effective.attack, effective.spAttack)
    : effective.attack;

  return (
    <div className="flex flex-col gap-3">
      {/* Level slider */}
      <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium text-ink">Level</label>
          <span className="rounded-md bg-grade-badge px-2 py-0.5 text-sm font-bold text-white">{loadout.level}</span>
        </div>
        <div className="py-3">
          <input
            type="range" min={1} max={15} value={loadout.level}
            onChange={(e) => dispatch({ type: "setLevel", level: Number(e.target.value) })}
            className="block w-full accent-grade-slider"
          />
        </div>
      </div>

      {/* Effective stats */}
      <CollapsibleCard title="Effective Stats" persistKey="stats">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
          {STAT_ROWS.map((row) => {
            const eff = effective[row.key];
            const delta = eff - base[row.key];
            const buffed = buffedStats.has(row.key);
            return (
              <div key={row.key} className={`flex items-baseline justify-between border-b py-1 ${buffed ? "border-as-border" : "border-line-soft"}`}>
                <dt className="text-sm text-muted">
                  {row.label}
                  {buffed && <span className="ml-1 align-middle text-[9px] font-bold uppercase text-as-ink">buff</span>}
                </dt>
                <dd className={`text-right font-mono text-sm font-semibold ${buffed ? "text-as-ink" : "text-ink"}`}>
                  {formatStat(eff, row.kind)}
                  {Math.abs(delta) > 1e-9 && (
                    <span className="ml-1 text-xs font-normal text-pos">
                      ({formatExactDelta(delta, row.kind)})
                    </span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
        <p className="mt-2 text-xs text-faint">
          Out-of-combat move speed: <span className="font-mono">{oocMoveSpeed?.toLocaleString()}</span>
          {emblemLoadout.activeSetBonuses.length > 0 && (
            <> · Set bonuses: {emblemLoadout.activeSetBonuses.map((b) => `${b.color} +${(b.bonusPercent * 100).toFixed(0)}%`).join(", ")}</>
          )}
        </p>
      </CollapsibleCard>

      {/* Attack speed (Expert) */}
      {expert && (
      <CollapsibleCard title="Attack Speed" persistKey="attackspeed" tone="amber" defaultOpen={false}>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Metric label="AS Stat" value={`${attackSpeed.asPoints.toFixed(1)}%`} />
          <Metric label="Frames / atk" value={String(attackSpeed.frames)} />
          <Metric label="Attacks / sec" value={attackSpeed.attacksPerSecond.toFixed(2)} />
        </div>
      </CollapsibleCard>
      )}

      {/* Combat analytics (Expert) */}
      {expert && (
      <CollapsibleCard title="Combat Analytics" persistKey="analytics" tone="sky" defaultOpen={false}>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Metric tone="sky" label="Physical eHP" value={Math.round(effectiveHp(effective.hp, effective.defense)).toLocaleString()} />
          <Metric tone="sky" label="Special eHP" value={Math.round(effectiveHp(effective.hp, effective.spDefense)).toLocaleString()} />
          <Metric tone="sky" label="Basic ATK/s*" value={Math.round(offenseStat * attackSpeed.attacksPerSecond).toLocaleString()} />
        </div>
        <p className="mt-2 text-[10px] text-faint">
          eHP = HP × (1 + Def/600). *Basic ATK/s is a relative index (offense × attacks/sec), for comparing builds — not in-game damage.
        </p>
      </CollapsibleCard>
      )}

      {/* Active effect toggles (Expert) */}
      {expert && (
      <CollapsibleCard title="Active Effects" persistKey="effects" defaultOpen={false}>
        <p className="mb-3 text-xs text-faint">Off by default. Toggle to preview in-combat attack-speed states.</p>
        {availableBoosts.length === 0 ? (
          <p className="text-sm text-faint">No toggleable effects for this loadout.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {availableBoosts.map((b) => {
              const avail = boostAvailableAtLevel(b, loadout.level);
              const pts = boostPointsAtLevel(b, loadout.level);
              const on = activeIds.has(b.id);
              return (
                <li key={b.id}>
                  <button
                    disabled={!avail}
                    onClick={() => dispatch({ type: "toggleBoost", id: b.id })}
                    title={b.note ?? ""}
                    className={`flex min-h-11 w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition
                      ${on ? "border-accent bg-accent-weak" : "border-line bg-surface hover:border-line"}
                      ${!avail ? "cursor-not-allowed opacity-40" : ""}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`inline-block h-3 w-3 rounded-full ${on ? "bg-accent" : "bg-faint"}`} />
                      <span className="font-medium text-ink">{b.label}</span>
                      <span className="text-xs uppercase text-faint">{b.source}</span>
                    </span>
                    <span className="font-mono text-xs text-muted">
                      +{avail ? pts.toFixed(1) : "—"}% AS{b.minLevel && !avail ? ` (Lv ${b.minLevel}+)` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CollapsibleCard>
      )}
    </div>
  );
}

function Metric({ label, value, tone = "amber" }: { label: string; value: string; tone?: "amber" | "sky" }) {
  const tones = {
    amber: { val: "text-as-ink", lbl: "text-as-ink", bg: "bg-surface/70" },
    sky: { val: "text-an-ink", lbl: "text-an-ink", bg: "bg-an-bg" },
  }[tone];
  return (
    <div className={`rounded-lg p-2 ${tones.bg}`}>
      <div className={`font-mono text-lg font-bold ${tones.val}`}>{value}</div>
      <div className={`text-xs ${tones.lbl}`}>{label}</div>
    </div>
  );
}
