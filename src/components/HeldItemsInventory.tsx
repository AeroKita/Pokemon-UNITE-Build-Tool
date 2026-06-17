import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import { heldItems, ITEM_GRADE_MAX } from "../data/gameData";
import { asset } from "../ui/asset";
import { HeldItemDetailModal } from "../ui/heldItemDetail";
import type { HeldItem } from "../types";

/**
 * Global held item grade inventory — set per-item grades (1–40) that sync with
 * the Builder's Held Items card. Icons only (Pokémon-picker tile styling).
 */
export function HeldItemsInventory() {
  const { heldItemGrade, setHeldItemGradeById } = useStore();
  const [query, setQuery] = useState("");
  const [detailItem, setDetailItem] = useState<HeldItem | null>(null);

  const shown = useMemo(
    () =>
      heldItems
        .filter((i) => i.displayName.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [query],
  );

  const detailGrade = detailItem ? heldItemGrade(detailItem.id) : 40;

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
      <div className="mb-3">
        <h2 className="text-lg font-bold text-ink">Held Items</h2>
        <p className="text-xs text-muted">
          Set each item&apos;s grade (1–{ITEM_GRADE_MAX}). Grades apply everywhere that item appears in your builds.
        </p>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search held items…"
        className="mb-3 w-full rounded-lg border border-line px-3 py-1.5 text-sm outline-none focus:border-accent"
      />

      <div className="grid max-h-[65vh] grid-cols-4 gap-3 overflow-y-auto sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
        {shown.map((item) => {
          const grade = heldItemGrade(item.id);
          const selected = detailItem?.id === item.id;
          return (
            <div key={item.id} className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => setDetailItem(item)}
                aria-pressed={selected}
                aria-label={item.displayName}
                className={`group relative aspect-square rounded-lg border-2 p-0.5 transition
                  ${selected
                    ? "border-transparent bg-mon-sel-bg ring-2 ring-mon-sel-ring"
                    : "border-transparent bg-mon-bg hover:border-mon-hover"}`}
              >
                <img
                  src={asset(item.iconAsset)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-contain"
                />
              </button>
              <div
                className="px-0.5"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="mb-0.5 flex items-center justify-between">
                  <span className="text-[9px] font-medium text-muted">G</span>
                  <span className="rounded bg-accent px-1 py-px text-[9px] font-bold text-white">{grade}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={ITEM_GRADE_MAX}
                  value={grade}
                  onChange={(e) => setHeldItemGradeById(item.id, Number(e.target.value))}
                  aria-label={`${item.displayName} grade`}
                  className="w-full accent-indigo-600"
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-xs text-faint">{shown.length} held items · tap an icon for details</p>

      <HeldItemDetailModal
        item={detailItem}
        grade={detailGrade}
        open={detailItem !== null}
        onClose={() => setDetailItem(null)}
      />
    </div>
  );
}
