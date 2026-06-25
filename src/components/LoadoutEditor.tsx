import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import {
  heldItems,
  battleItems,
  emblems,
  heldItemById,
  battleItemById,
  emblemById,
  isUniqueHeldItem,
} from "../data/gameData";
import { MAX_EMBLEMS } from "../state/loadout";
import { asset } from "../ui/asset";
import { emblemIconForGrade } from "../ui/emblemIcon";
import { heldItemStatLines, statLines } from "../ui/format";
import { gradesForEmblem } from "../ui/emblems";
import { EMBLEM_COLOR_HEX, ALL_EMBLEM_COLORS, EMBLEM_GRADE_HEX } from "../ui/colors";
import { PickerModal, type PickItem } from "./PickerModal";
import { EmblemSetSummary } from "./EmblemSetSummary";
import { CollapsibleCard } from "./CollapsibleCard";
import { Tooltip } from "./Tooltip";
import { GradeField } from "./GradeField";
import { itemTip, emblemTip, statsAtGrade } from "./tips";

type Picker = { kind: "held"; slot: number } | { kind: "battle" } | { kind: "emblem" } | null;

export function LoadoutEditor() {
  const {
    loadout,
    dispatch,
    owned,
    toggleOwned,
    expert,
    heldSlotGrades,
    setHeldItemGradeForSlot,
    heldItemGrade,
  } = useStore();
  const [picker, setPicker] = useState<Picker>(null);

  const emblemGoldOnlyIds = useMemo(
    () => new Set(emblems.filter((e) => e.goldOnly).map((e) => e.id)),
    [],
  );

  const heldPickItems: PickItem[] = heldItems.map((i) => ({
    id: i.id,
    name: i.displayName,
    icon: i.iconAsset,
    title: i.description,
    tip: itemTip(i, heldItemGrade(i.id)),
  }));
  const battlePickItems: PickItem[] = battleItems.map((i) => ({
    id: i.id,
    name: i.displayName,
    icon: i.iconAsset,
    title: i.description,
    tip: itemTip(i),
  }));
  const emblemPickItems: PickItem[] = emblems.map((e) => ({
    id: e.id,
    name: e.pokemonName,
    icon: e.iconAsset,
    colors: e.colors,
  }));

  return (
    <div className="flex flex-col gap-3">
      {/* Held items */}
      <Section title="Held Items">
        <div className="flex flex-col gap-3">
          {loadout.heldItemIds.map((id, slot) => {
            const item = id ? heldItemById.get(id) : null;
            const grade = heldSlotGrades[slot];
            return (
              <div key={slot} className="flex flex-wrap items-start gap-3">
                <Tooltip content={item ? itemTip(item, grade) : "Add a held item"}>
                  <button
                    onClick={() => setPicker({ kind: "held", slot })}
                    className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-xl border-2 border-dashed border-line p-1 hover:border-accent hover:bg-accent-weak"
                  >
                    {item ? (
                      <>
                        <img
                          src={asset(item.iconAsset)}
                          alt={item.displayName}
                          className="h-10 w-10 object-contain"
                        />
                        <span className="mt-0.5 text-[10px] leading-tight text-muted">
                          {item.displayName}
                        </span>
                      </>
                    ) : (
                      <span className="text-2xl text-faint">+</span>
                    )}
                  </button>
                </Tooltip>
                {item && !isUniqueHeldItem(item) && (
                  <div className="min-w-[10rem] flex-1">
                    <div className="mb-1 flex items-center justify-between">
                      <label className="text-xs font-medium text-muted">Grade</label>
                      <GradeField
                        value={grade}
                        label={item!.displayName}
                        onCommit={(g) => setHeldItemGradeForSlot(slot, g)}
                      />
                    </div>
                    <div className="py-3">
                      <input
                        type="range"
                        min={1}
                        max={40}
                        value={grade}
                        onChange={(e) => setHeldItemGradeForSlot(slot, Number(e.target.value))}
                        className="block w-full accent-grade-slider"
                      />
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-faint">
                      {heldItemStatLines(statsAtGrade(item, grade))
                        .map((l) => `${l.label} ${l.value}`)
                        .join(" · ") || "—"}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* Trainer (battle) item */}
      <Section title="Trainer Item">
        <Tooltip
          content={
            loadout.battleItemId && battleItemById.get(loadout.battleItemId)
              ? itemTip(battleItemById.get(loadout.battleItemId)!)
              : "Add a Trainer Item"
          }
        >
          <button
            onClick={() => setPicker({ kind: "battle" })}
            className="flex h-20 w-20 flex-col items-center justify-center rounded-xl border-2 border-dashed border-line p-1 hover:border-accent hover:bg-accent-weak"
          >
            {loadout.battleItemId && battleItemById.get(loadout.battleItemId) ? (
              <>
                <img
                  src={asset(battleItemById.get(loadout.battleItemId)!.iconAsset)}
                  alt=""
                  className="h-10 w-10 object-contain"
                />
                <span className="mt-0.5 text-[10px] leading-tight text-muted">
                  {battleItemById.get(loadout.battleItemId)!.displayName}
                </span>
              </>
            ) : (
              <span className="text-2xl text-faint">+</span>
            )}
          </button>
        </Tooltip>
      </Section>

      {/* Emblems */}
      <Section title={`Emblems (${loadout.emblems.length}/${MAX_EMBLEMS})`}>
        <div className="flex flex-wrap gap-1.5">
          {loadout.emblems.map((pick, i) => {
            const emblem = emblemById.get(pick.emblemId);
            if (!emblem) return null;
            return (
              <div key={i} className="flex flex-col items-center rounded-lg border border-line p-1">
                <Tooltip content={emblemTip(emblem, pick.grade)}>
                  <span className="relative inline-block">
                    <img
                      src={asset(emblemIconForGrade(emblem, pick.grade))}
                      alt={emblem.pokemonName}
                      className="h-16 w-16 object-contain"
                    />
                    <span className="absolute -left-1 -top-1 flex gap-0.5">
                      {emblem.colors.map((c) => (
                        <span
                          key={c}
                          className="h-2.5 w-2.5 rounded-full ring-1 ring-white"
                          style={{ background: EMBLEM_COLOR_HEX[c] }}
                        />
                      ))}
                    </span>
                  </span>
                </Tooltip>
                <div className="mt-0.5 flex gap-0.5">
                  {gradesForEmblem(emblem).map((g) => {
                    const on = pick.grade === g;
                    return (
                      <button
                        key={g}
                        type="button"
                        title={g}
                        aria-label={`${g} grade`}
                        aria-pressed={on}
                        onClick={() => dispatch({ type: "setEmblemGrade", index: i, grade: g })}
                        className="flex h-11 w-11 items-center justify-center rounded-full transition"
                      >
                        <span
                          className={`h-4 w-4 rounded-full border border-black/20 ${
                            on ? "ring-2 ring-ink ring-offset-1 ring-offset-surface" : "opacity-50"
                          }`}
                          style={{ background: EMBLEM_GRADE_HEX[g] }}
                        />
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => dispatch({ type: "removeEmblem", index: i })}
                  className="min-h-11 px-2 text-sm text-neg hover:text-neg"
                >
                  remove
                </button>
              </div>
            );
          })}
          {loadout.emblems.length < MAX_EMBLEMS && (
            <button
              onClick={() => setPicker({ kind: "emblem" })}
              className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-line text-2xl text-faint hover:border-accent hover:bg-accent-weak"
            >
              +
            </button>
          )}
        </div>
        {loadout.emblems.length > 0 && (
          <div className="mt-3">
            <EmblemSetSummary picks={loadout.emblems} precise={expert} />
          </div>
        )}
      </Section>

      {picker?.kind === "held" && (
        <PickerModal
          title="Choose Held Item"
          items={heldPickItems}
          onPick={(id) => dispatch({ type: "setHeldItem", slot: picker.slot, id })}
          onClear={() => dispatch({ type: "setHeldItem", slot: picker.slot, id: null })}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.kind === "battle" && (
        <PickerModal
          title="Choose Trainer Item"
          items={battlePickItems}
          onPick={(id) => dispatch({ type: "setBattleItem", id })}
          onClear={() => dispatch({ type: "setBattleItem", id: null })}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.kind === "emblem" && (
        <PickerModal
          title="Choose Emblem"
          items={emblemPickItems}
          onPick={(id, grade) =>
            dispatch({ type: "addEmblem", emblemId: id, grade: grade ?? "gold" })
          }
          onClose={() => setPicker(null)}
          grades
          owned={owned}
          onToggleOwn={toggleOwned}
          goldOnlyIds={emblemGoldOnlyIds}
          iconForGrade={(id, g) => emblemIconForGrade({ id }, g)}
          subtitleForGrade={(id, g) => {
            const e = emblemById.get(id);
            if (!e) return "";
            return (
              statLines(e.statsByGrade[g === "platinum" ? "gold" : g], true)
                .map((l) => `${l.label} ${l.value}`)
                .join(" · ") || "—"
            );
          }}
          tipForGrade={(id, g) => {
            const e = emblemById.get(id);
            return e ? emblemTip(e, g) : null;
          }}
          filters={ALL_EMBLEM_COLORS.map((c) => ({
            label: c,
            activeColor: EMBLEM_COLOR_HEX[c],
            predicate: (id) => emblemById.get(id)?.colors.includes(c) ?? false,
          }))}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <CollapsibleCard
      title={title}
      persistKey={`editor-${title.split(" ")[0].toLowerCase()}`}
      defaultOpen={false}
    >
      {children}
    </CollapsibleCard>
  );
}
