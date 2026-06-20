// Shared tooltip content builders for items and emblems (used by the Recommend
// panel and the loadout editor).
import { ITEM_GRADE_DEFAULT } from "../data/gameData";
import { heldItemStatLines, statLines } from "../ui/format";
import type { BattleItem, Emblem, EmblemGrade, HeldItem, Move, StatBlock } from "../types";
import { MoveMedia } from "./MoveMedia";

export function statsAtGrade(item: HeldItem, grade: number): Partial<StatBlock> {
  const g = item.statsByGrade as Record<string | number, Partial<StatBlock>>;
  return g[grade] ?? g[String(grade)] ?? {};
}

/** The description to show for the current mode: Advanced text when in Advanced
 *  mode and present, otherwise the Basic description. */
export function pickDescription(
  d: { description: string; descriptionAdvanced?: string },
  advanced: boolean,
): string {
  return advanced && d.descriptionAdvanced ? d.descriptionAdvanced : d.description;
}

export function moveTip(move: Move, advanced: boolean) {
  const desc = pickDescription(move, advanced);
  return (
    <span>
      <span className="font-semibold">{move.name}</span>
      {move.moveType && <span className="ml-1 text-faint">· {move.moveType}</span>}
      {move.upgradeLevel ? <span className="ml-1 text-faint">· Lv {move.upgradeLevel}</span> : null}
      {move.cooldownSeconds > 0 && (
        <span className="ml-1 text-faint">· {move.cooldownSeconds}s CD</span>
      )}
      {desc && <span className="mt-0.5 block text-faint">{desc}</span>}
      <MoveMedia
        videoAsset={move.videoAsset}
        gifAsset={move.gifAsset}
        iconAsset={move.iconAsset}
        name={move.name}
      />
    </span>
  );
}

export function itemTip(item: HeldItem | BattleItem, grade = ITEM_GRADE_DEFAULT) {
  const stats =
    "statsByGrade" in item ? heldItemStatLines(statsAtGrade(item as HeldItem, grade)) : [];
  return (
    <span>
      <span className="font-semibold">{item.displayName}</span>
      {item.description && <span className="mt-0.5 block text-faint">{item.description}</span>}
      {stats.length > 0 && (
        <span className="mt-1 block text-faint">
          {stats.map((l) => `${l.label} ${l.value}`).join(" · ")}
        </span>
      )}
    </span>
  );
}

export function emblemTip(emblem: Emblem, grade: EmblemGrade) {
  const key = grade === "platinum" ? "gold" : grade;
  const stats = statLines(emblem.statsByGrade[key]);
  return (
    <span>
      <span className="font-semibold capitalize">
        {emblem.pokemonName} · {grade}
      </span>
      <span className="mt-0.5 block capitalize text-faint">{emblem.colors.join(" / ")}</span>
      <span className="mt-1 block text-faint">
        {stats.map((l) => `${l.label} ${l.value}`).join(" · ") || "no flat stats"}
      </span>
    </span>
  );
}
