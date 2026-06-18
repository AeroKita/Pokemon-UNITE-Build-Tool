import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import { heldItems, isUniqueHeldItem, ITEM_GRADE_MAX } from "../data/gameData";
import { asset } from "../ui/asset";
import { HeldItemDetailModal } from "../ui/heldItemDetail";
import { GradeField } from "./GradeField";
import type { HeldItem } from "../types";

function ItemTile({
  item,
  selected,
  onSelect,
  grade,
  onGradeChange,
  showGradeControls,
}: {
  item: HeldItem;
  selected: boolean;
  onSelect: () => void;
  grade?: number;
  onGradeChange?: (g: number) => void;
  showGradeControls: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={item.displayName}
        className={`group relative aspect-square min-h-11 rounded-lg border-2 p-0.5 transition
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
      {showGradeControls && grade !== undefined && onGradeChange && (
        <div
          className="px-0.5"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="mb-0.5 flex items-center justify-between">
            <span className="text-[9px] font-medium text-muted">Grade</span>
            <GradeField value={grade} label={item.displayName} onCommit={onGradeChange} />
          </div>
          <div className="py-3">
            <input
              type="range"
              min={1}
              max={ITEM_GRADE_MAX}
              value={grade}
              onChange={(e) => onGradeChange(Number(e.target.value))}
              aria-label={`${item.displayName} grade`}
              className="block w-full accent-grade-slider"
            />
          </div>
        </div>
      )}
    </div>
  );
}

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

  const gradedItems = shown.filter((i) => !isUniqueHeldItem(i));
  const uniqueItems = shown.filter((i) => isUniqueHeldItem(i));

  const detailGrade = detailItem ? heldItemGrade(detailItem.id) : 40;

  return (
    <div className="rounded-2xl border border-line bg-surface p-3 shadow-sm">
      <div className="mb-3">
        <p className="text-xs text-muted">
          Set each item&apos;s grade (1–{ITEM_GRADE_MAX}). Grades apply everywhere that item appears in your builds. Tap on a Held Item for more info!
        </p>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search held items…"
        className="mb-3 min-h-11 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent"
      />

      <div className="grid max-h-[65vh] grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
        {gradedItems.map((item) => {
          const grade = heldItemGrade(item.id);
          const selected = detailItem?.id === item.id;
          return (
            <ItemTile
              key={item.id}
              item={item}
              selected={selected}
              onSelect={() => setDetailItem(item)}
              grade={grade}
              onGradeChange={(g) => setHeldItemGradeById(item.id, g)}
              showGradeControls
            />
          );
        })}
      </div>

      {uniqueItems.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-semibold text-ink">Unique Items</h3>
          <p className="mb-2 text-xs text-muted">Mega Stones &amp; Rusted Sword have no grade or level.</p>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
            {uniqueItems.map((item) => {
              const selected = detailItem?.id === item.id;
              return (
                <ItemTile
                  key={item.id}
                  item={item}
                  selected={selected}
                  onSelect={() => setDetailItem(item)}
                  showGradeControls={false}
                />
              );
            })}
          </div>
        </div>
      )}

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
