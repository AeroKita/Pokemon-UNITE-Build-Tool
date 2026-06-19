import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import { pokemonById } from "../data/gameData";
import { deriveBuild } from "../engine/derive";
import { toLoadout, type Loadout } from "../state/loadout";
import { STAT_ROWS, formatStat, formatDelta } from "../ui/format";
import { CollapsibleCard } from "./CollapsibleCard";

// Compare two builds on one Pokémon: pick A and B from "current" + saved.
export function CompareView() {
  const { loadout, saved, heldSlotGrades } = useStore();
  const options = useMemo(
    () => [
      { id: "__current__", name: "Current build", loadout },
      ...saved.map((s) => ({ id: s.id, name: s.name, loadout: toLoadout(s) })),
    ],
    [loadout, saved],
  );
  const [aId, setAId] = useState("__current__");
  const [bId, setBId] = useState(saved[0]?.id ?? "__current__");

  const a = options.find((o) => o.id === aId)?.loadout ?? loadout;
  const b = options.find((o) => o.id === bId)?.loadout ?? loadout;
  const da = useMemo(() => deriveBuild(a, true, heldSlotGrades), [a, heldSlotGrades]);
  const db = useMemo(() => deriveBuild(b, true, heldSlotGrades), [b, heldSlotGrades]);

  return (
    <CollapsibleCard title="Compare Builds" persistKey="compare">
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <BuildSelect label="A" value={aId} onChange={setAId} options={options} />
        <BuildSelect label="B" value={bId} onChange={setBId} options={options} />
      </div>
      {da.pokemon && db.pokemon && da.pokemon.id !== db.pokemon.id && (
        <p className="mb-2 rounded-lg bg-as-bg px-3 py-1.5 text-xs text-as-ink">
          Comparing across different Pokémon ({da.pokemon.displayName} vs {db.pokemon.displayName}).
        </p>
      )}
      {!da.effective || !db.effective ? (
        <p className="text-sm text-faint">Both builds need a Pokémon selected.</p>
      ) : (
        <div className="-mx-1 min-w-0 overflow-x-auto px-1">
          <table className="w-full min-w-[20rem] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-faint">
                <th className="py-1">Stat</th>
                <th className="py-1 text-right">A</th>
                <th className="py-1 text-right">B</th>
                <th className="py-1 text-right">Δ (B−A)</th>
              </tr>
            </thead>
            <tbody>
              {STAT_ROWS.map((row) => {
                const av = da.effective![row.key];
                const bv = db.effective![row.key];
                const delta = bv - av;
                const better = delta > 1e-9;
                const worse = delta < -1e-9;
                return (
                  <tr key={row.key} className="border-t border-line-soft">
                    <td className="py-1 text-muted">{row.label}</td>
                    <td className="py-1 text-right font-mono">{formatStat(av, row.kind)}</td>
                    <td className="py-1 text-right font-mono">{formatStat(bv, row.kind)}</td>
                    <td
                      className={`py-1 text-right font-mono ${better ? "text-pos" : worse ? "text-neg" : "text-faint"}`}
                    >
                      {Math.abs(delta) < 1e-9 ? "—" : formatDelta(delta, row.kind)}
                    </td>
                  </tr>
                );
              })}
              {da.attackSpeed && db.attackSpeed && (
                <tr className="border-t border-line font-semibold">
                  <td className="py-1 text-muted">Attacks / sec</td>
                  <td className="py-1 text-right font-mono">
                    {da.attackSpeed.attacksPerSecond.toFixed(2)}
                  </td>
                  <td className="py-1 text-right font-mono">
                    {db.attackSpeed.attacksPerSecond.toFixed(2)}
                  </td>
                  <td className="py-1 text-right font-mono text-muted">
                    {(db.attackSpeed.attacksPerSecond - da.attackSpeed.attacksPerSecond).toFixed(2)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </CollapsibleCard>
  );
}

function BuildSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; name: string; loadout: Loadout }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      <span>Build {label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 rounded-lg border border-line bg-surface px-2 py-2 text-sm text-ink"
      >
        {options.map((o) => {
          const p = o.loadout.pokemonId ? pokemonById.get(o.loadout.pokemonId) : null;
          return (
            <option key={o.id} value={o.id}>
              {o.name}
              {p ? ` — ${p.displayName}` : ""}
            </option>
          );
        })}
      </select>
    </label>
  );
}
