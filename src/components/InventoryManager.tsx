import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import { emblems as allEmblems } from "../data/gameData";
import { asset } from "../ui/asset";
import { EMBLEM_COLOR_HEX, ALL_EMBLEM_COLORS, EMBLEM_GRADE_HEX } from "../ui/colors";
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
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
            Emblem Inventory
            <button
              onClick={() => setGuideOpen(true)}
              aria-label="Emblem color sets guide"
              title="What do the colors do?"
              className="flex h-5 w-5 items-center justify-center rounded-full border border-line text-xs font-bold text-muted hover:bg-raise hover:text-ink"
            >
              ?
            </button>
          </h2>
          <p className="text-xs text-muted">
            Mark what you own per grade — owned emblems are highlighted in pickers and preferred by recommendations.
          </p>
        </div>
        <div className="text-right text-sm">
          <span className="font-semibold" style={{ color: EMBLEM_GRADE_HEX[grade] }}>{ownedCount}</span>
          <span className="text-faint"> / {gradeEmblems.length} {grade} owned</span>
        </div>
      </div>

      {/* Controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-raise p-0.5">
          {GRADES.map((g) => (
            <button
              key={g}
              onClick={() => setGrade(g)}
              className={`rounded-md px-3 py-1 text-xs font-semibold capitalize transition ${
                grade === g ? "bg-surface shadow-sm" : "text-muted hover:text-ink"
              }`}
              style={grade === g ? { color: EMBLEM_GRADE_HEX[g] } : undefined}
            >
              {g}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="flex-1 rounded-lg border border-line px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <select
          value={color}
          onChange={(e) => setColor(e.target.value as EmblemColor | "all")}
          className="rounded-lg border border-line px-2 py-1.5 text-sm capitalize"
        >
          <option value="all">All colors</option>
          {ALL_EMBLEM_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={() => bulkSetOwned(shownIds, grade, true)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
          Own all shown
        </button>
        <button onClick={() => bulkSetOwned(shownIds, grade, false)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted hover:bg-raise">
          Clear shown
        </button>
      </div>

      {/* Grid */}
      <div className="grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((e) => {
          const isOwned = owned.has(ownedKey(e.id, grade));
          // Inventory always shows exact decimals (never rounds).
          const stats = statLines(e.statsByGrade[grade === "platinum" ? "gold" : grade], true);
          return (
            <button
              key={e.id}
              onClick={() => toggleOwned(e.id, grade)}
              className={`relative flex items-center gap-2 rounded-xl border p-2 text-left transition ${
                isOwned ? "border-as-border bg-as-bg" : "border-line hover:border-line"
              }`}
            >
              <span className="relative shrink-0">
                <img src={asset(emblemIconForGrade(e, grade))} alt={e.pokemonName} loading="lazy" className="h-10 w-10 object-contain" />
                <span className="absolute -left-0.5 -top-0.5 flex gap-0.5">
                  {e.colors.map((c) => (
                    <span key={c} className="h-2 w-2 rounded-full ring-1 ring-white" style={{ background: EMBLEM_COLOR_HEX[c] }} />
                  ))}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-ink">{e.pokemonName}</span>
                <span className="block truncate text-[10px] text-faint">
                  {stats.map((l) => `${l.label} ${l.value}`).join(" · ") || "—"}
                </span>
              </span>
              <span className={`text-base leading-none ${isOwned ? "text-as-ink" : "text-faint"}`}>★</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-faint">{shown.length} shown</p>
      <EmblemSetGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
