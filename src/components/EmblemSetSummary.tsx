import { emblemById, setBonuses } from "../data/gameData";
import { sumEmblemFlats, countColors, computeEmblemLoadout } from "../engine/emblems";
import { statLines } from "../ui/format";
import { EMBLEM_COLOR_HEX } from "../ui/colors";
import type { EmblemColor, EmblemGrade, StatBlock } from "../types";

// Short stat labels for the color-set bonuses.
const STAT_LABEL: Partial<Record<keyof StatBlock, string>> = {
  attack: "Atk",
  spAttack: "Sp.Atk",
  defense: "Def",
  spDefense: "Sp.Def",
  hp: "HP",
  attackSpeed: "Atk Spd",
  cdr: "CDR",
  moveSpeed: "Move",
};

/**
 * The net flat stats a 10-emblem set provides in isolation (rounded as in-game),
 * plus per-color counts and the active set-bonus %. Mirrors UNITE-DB's
 * "Equipped Stats" + "Equipped Sets" panels.
 */
export function EmblemSetSummary({
  picks,
  precise = false,
}: {
  picks: { emblemId: string; grade: EmblemGrade }[];
  precise?: boolean;
}) {
  const slots = picks
    .map((p) => {
      const e = emblemById.get(p.emblemId);
      return e ? { emblem: e, grade: p.grade } : null;
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
  if (slots.length === 0) return null;

  const flats = sumEmblemFlats(slots); // raw, unrounded; display applies rounding/precision
  const lines = statLines(flats, precise);
  const counts = countColors(slots);
  const bonusByColor = new Map(
    computeEmblemLoadout(slots, setBonuses).activeSetBonuses.map((b) => [b.color, b.bonusPercent]),
  );
  const statByColor = new Map(setBonuses.map((s) => [s.color, s.stat]));
  const colorRows = [...counts.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-surface/60 p-3 ring-1 ring-line">
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
          Emblem Stats
        </p>
        <div className="flex flex-col gap-0.5">
          {lines.length === 0 ? (
            <span className="text-xs text-faint">No flat stats</span>
          ) : (
            lines.map((l) => (
              <div key={l.key} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-muted">{l.label}</span>
                <span
                  className={`font-mono font-semibold ${l.sign === "pos" ? "text-pos" : "text-neg"}`}
                >
                  {l.value}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
          Color Sets
        </p>
        <div className="flex flex-col gap-0.5">
          {colorRows.map(([color, n]) => {
            const bonus = bonusByColor.get(color as EmblemColor);
            const stat = statByColor.get(color as EmblemColor);
            return (
              <div key={color} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10"
                    style={{ background: EMBLEM_COLOR_HEX[color as EmblemColor] }}
                  />
                  <span className="capitalize text-muted">{color}</span>
                  <span className="text-faint">×{n}</span>
                </span>
                <span className={`font-mono ${bonus ? "font-semibold text-ink" : "text-faint"}`}>
                  {bonus
                    ? `+${(bonus * 100).toFixed(0)}% ${stat ? (STAT_LABEL[stat] ?? stat) : ""}`
                    : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
