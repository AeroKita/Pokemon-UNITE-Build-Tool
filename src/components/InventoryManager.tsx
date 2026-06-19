import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import { emblems as allEmblems } from "../data/gameData";
import { asset } from "../ui/asset";
import {
  EMBLEM_COLOR_HEX,
  ALL_EMBLEM_COLORS,
  EMBLEM_GRADE_HEX,
  readableTextColor,
} from "../ui/colors";
import { statLines } from "../ui/format";
import { emblemsForGrade } from "../ui/emblems";
import { ownedKey } from "../state/loadout";
import { emblemIconForGrade } from "../ui/emblemIcon";
import { EmblemSetGuide } from "./EmblemSetGuide";
import type { EmblemColor, EmblemGrade } from "../types";

const GRADES: EmblemGrade[] = ["bronze", "silver", "gold"];

/**
 * Manage which emblems you own, per grade (Bronze/Silver/Gold independent).
 * Search, filter by color, bulk own/clear the current view, and see live counts.
 */
export function InventoryManager() {
  const { owned, toggleOwned, bulkSetOwned } = useStore();
  const [grade, setGrade] = useState<EmblemGrade>("gold");
  const [query, setQuery] = useState("");
  const [color, setColor] = useState<EmblemColor | "all">("all");
  const [guideOpen, setGuideOpen] = useState(false);

  const gradeEmblems = useMemo(() => emblemsForGrade(allEmblems, grade), [grade]);

  const shown = useMemo(
    () =>
      gradeEmblems.filter(
        (e) =>
          e.pokemonName.toLowerCase().includes(query.toLowerCase()) &&
          (color === "all" || e.colors.includes(color)),
      ),
    [gradeEmblems, query, color],
  );

  const ownedCount = useMemo(
    () => gradeEmblems.reduce((n, e) => n + (owned.has(ownedKey(e.id, grade)) ? 1 : 0), 0),
    [owned, grade, gradeEmblems],
  );
  const shownIds = shown.map((e) => e.id);

  return (
    <div className="rounded-2xl border border-line bg-surface p-3 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-ink">
            Inventory
            <button
              onClick={() => setGuideOpen(true)}
              aria-label="Emblem color sets guide"
              title="What do the colors do?"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-line text-sm font-bold text-muted hover:bg-raise hover:text-ink"
            >
              ?
            </button>
          </h2>
          <p className="text-xs text-muted">
            Mark what you own per grade — owned emblems are highlighted in pickers and preferred by
            recommendations.
          </p>
        </div>
        <div className="text-right text-sm">
          <span className="font-semibold" style={{ color: EMBLEM_GRADE_HEX[grade] }}>
            {ownedCount}
          </span>
          <span className="text-faint">
            {" "}
            / {gradeEmblems.length} {grade} owned
          </span>
        </div>
      </div>

      <div className="mb-3 flex flex-col gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="min-h-11 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent"
        />

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-raise p-0.5">
            {GRADES.map((g) => (
              <button
                key={g}
                onClick={() => setGrade(g)}
                className={`min-h-11 rounded-md px-3 py-2 text-xs font-semibold capitalize transition ${
                  grade === g ? "bg-surface shadow-sm" : "text-muted hover:text-ink"
                }`}
                style={grade === g ? { color: EMBLEM_GRADE_HEX[g] } : undefined}
              >
                {g}
              </button>
            ))}
          </div>
          <div className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1 pb-0.5">
            <ColorFilterChip label="All" active={color === "all"} onClick={() => setColor("all")} />
            {ALL_EMBLEM_COLORS.map((c) => (
              <ColorFilterChip
                key={c}
                label={c}
                active={color === c}
                activeColor={EMBLEM_COLOR_HEX[c]}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => bulkSetOwned(shownIds, grade, true)}
            className="min-h-11 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Own all shown
          </button>
          <button
            onClick={() => bulkSetOwned(shownIds, grade, false)}
            className="min-h-11 rounded-lg border border-line px-3 py-2 text-sm font-medium text-muted hover:bg-raise"
          >
            Clear shown
          </button>
        </div>
      </div>

      <div className="grid max-h-[60vh] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 md:grid-cols-3">
        {shown.map((e) => {
          const isOwned = owned.has(ownedKey(e.id, grade));
          const stats = statLines(e.statsByGrade[grade === "platinum" ? "gold" : grade], true);
          return (
            <button
              key={e.id}
              onClick={() => toggleOwned(e.id, grade)}
              className={`relative flex min-h-11 items-center gap-2 rounded-xl border p-2 text-left transition ${
                isOwned ? "border-as-border bg-as-bg" : "border-line hover:border-line"
              }`}
            >
              <span className="relative shrink-0">
                <img
                  src={asset(emblemIconForGrade(e, grade))}
                  alt={e.pokemonName}
                  loading="lazy"
                  className="h-10 w-10 object-contain"
                />
                <span className="absolute -left-0.5 -top-0.5 flex gap-0.5">
                  {e.colors.map((c) => (
                    <span
                      key={c}
                      className="h-2 w-2 rounded-full ring-1 ring-white"
                      style={{ background: EMBLEM_COLOR_HEX[c] }}
                    />
                  ))}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-ink">{e.pokemonName}</span>
                <span className="block truncate text-[10px] text-faint">
                  {stats.map((l) => `${l.label} ${l.value}`).join(" · ") || "—"}
                </span>
              </span>
              <span className={`text-base leading-none ${isOwned ? "text-as-ink" : "text-faint"}`}>
                ★
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-faint">{shown.length} shown</p>
      <EmblemSetGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}

function ColorFilterChip({
  label,
  active,
  onClick,
  activeColor,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  activeColor?: string;
}) {
  const style =
    active && activeColor
      ? { background: activeColor, color: readableTextColor(activeColor) }
      : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      className={`shrink-0 rounded-full border px-3 py-2 text-xs font-medium capitalize ${
        active
          ? activeColor
            ? "border-line"
            : "border-transparent bg-accent text-white"
          : "border-transparent bg-raise text-muted hover:bg-raise"
      } min-h-11`}
    >
      {label}
    </button>
  );
}
