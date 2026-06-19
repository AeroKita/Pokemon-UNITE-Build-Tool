import { useMemo } from "react";
import { useStore } from "../state/store";
import { deriveBuild } from "../engine/derive";
import { formatStat } from "../ui/format";

interface BuildSummaryBarProps {
  onOpenPokePicker: () => void;
}

/**
 * Sticky glance hero: primary offense stat, HP/Def/AS row, and level pill.
 */
export function BuildSummaryBar({ onOpenPokePicker }: BuildSummaryBarProps) {
  const { loadout, heldSlotGrades } = useStore();
  const derived = useMemo(
    () => deriveBuild(loadout, true, heldSlotGrades),
    [loadout, heldSlotGrades],
  );
  const { pokemon, effective } = derived;

  if (!pokemon || !effective) {
    return (
      <button
        type="button"
        onClick={onOpenPokePicker}
        className="sticky top-[calc(56px+env(safe-area-inset-top))] z-20 w-full rounded-2xl border border-line bg-surface px-4 py-3 text-left shadow-sm"
      >
        <span className="text-base font-semibold text-accent">Select a Pokémon</span>
      </button>
    );
  }

  const offenseValue =
    pokemon.attackType === "special"
      ? effective.spAttack
      : pokemon.attackType === "hybrid"
        ? Math.max(effective.attack, effective.spAttack)
        : effective.attack;

  const offenseLabel =
    pokemon.attackType === "special"
      ? "Sp. Atk"
      : pokemon.attackType === "hybrid"
        ? effective.spAttack >= effective.attack
          ? "Sp. Atk"
          : "Attack"
        : "Attack";

  const secondary = [
    { label: "HP", value: formatStat(effective.hp, "int") },
    { label: "Defense", value: formatStat(effective.defense, "int") },
    { label: "Atk Speed", value: formatStat(effective.attackSpeed, "percent") },
  ] as const;

  return (
    <div className="sticky top-[calc(56px+env(safe-area-inset-top))] z-20 rounded-2xl border border-line bg-surface px-4 py-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-4xl font-bold leading-none text-accent">
            {formatStat(offenseValue, "int")}
          </div>
          <div className="mt-0.5 text-xs text-faint">{offenseLabel}</div>
        </div>
        <span className="shrink-0 rounded-md bg-grade-badge px-2 py-0.5 text-sm font-bold text-white">
          Lv {loadout.level}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line-soft pt-3">
        {secondary.map(({ label, value }) => (
          <div key={label} className="text-center">
            <div className="font-mono text-sm font-semibold text-ink">{value}</div>
            <div className="text-xs text-faint">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
