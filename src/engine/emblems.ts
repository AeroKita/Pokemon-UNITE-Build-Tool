// Emblem loadout aggregation — fills the gap the schema declares as
// "computed at runtime": EmblemLoadout.flatTotals and .activeSetBonuses.
//
// Rules (docs/03-Calculation-Engine.md):
//   - Flat stats sum across ALL slots (a duplicate Pokémon's flats still count).
//   - For COLOR COUNTS, only one emblem per Pokémon counts toward a color set
//     (duplicates of the same Pokémon at different grades count once).
//   - A 2-color emblem counts toward BOTH colors.
//   - Platinum emblems use the same stat values as Gold (cosmetic upgrade).
//   - The highest threshold met per color wins (2/4/6 or 3/5/7 scales).

import type { EmblemColor, EmblemLoadout, EmblemSetBonus, EmblemSlot, StatBlock } from "../types";

export const MAX_EMBLEM_SLOTS = 10;

/** Grade key into Emblem.statsByGrade — platinum shares gold's values. */
function gradeKey(grade: EmblemSlot["grade"]): "bronze" | "silver" | "gold" {
  return grade === "platinum" ? "gold" : grade;
}

/** Sum raw (unrounded) flat stats across all slots. */
export function sumEmblemFlats(slots: EmblemSlot[]): Partial<StatBlock> {
  const totals: Partial<StatBlock> = {};
  for (const slot of slots) {
    const stats = slot.emblem.statsByGrade[gradeKey(slot.grade)];
    for (const key of Object.keys(stats) as (keyof StatBlock)[]) {
      totals[key] = (totals[key] ?? 0) + (stats[key] ?? 0);
    }
  }
  return totals;
}

/**
 * Count emblems per color. Duplicates of the same Pokémon count once;
 * a 2-color emblem counts toward both of its colors.
 */
export function countColors(slots: EmblemSlot[]): Map<EmblemColor, number> {
  const counted = new Map<EmblemColor, Set<string>>();
  for (const slot of slots) {
    for (const color of slot.emblem.colors) {
      let pokemonSeen = counted.get(color);
      if (!pokemonSeen) {
        pokemonSeen = new Set();
        counted.set(color, pokemonSeen);
      }
      pokemonSeen.add(slot.emblem.pokemonName);
    }
  }
  const counts = new Map<EmblemColor, number>();
  for (const [color, pokemonSeen] of counted) {
    counts.set(color, pokemonSeen.size);
  }
  return counts;
}

/** Highest threshold ≤ count wins; null if none met. */
export function activeBonusPercent(
  count: number,
  thresholds: Record<number, number>,
): number | null {
  let best: number | null = null;
  let bestThreshold = -1;
  for (const key of Object.keys(thresholds)) {
    const threshold = Number(key);
    if (threshold <= count && threshold > bestThreshold) {
      bestThreshold = threshold;
      best = thresholds[threshold];
    }
  }
  return best;
}

/**
 * Build a complete EmblemLoadout (slots + computed flatTotals and
 * activeSetBonuses) from equipped slots and the patch's set-bonus table.
 * flatTotals stays RAW here — computeEffectiveStats applies the standard
 * rounding once, on the summed totals.
 */
export function computeEmblemLoadout(
  slots: EmblemSlot[],
  setBonuses: EmblemSetBonus[],
): EmblemLoadout {
  if (slots.length > MAX_EMBLEM_SLOTS) {
    throw new Error(`Emblem loadout has ${slots.length} slots; max is ${MAX_EMBLEM_SLOTS}`);
  }

  const counts = countColors(slots);
  const activeSetBonuses: EmblemLoadout["activeSetBonuses"] = [];
  for (const def of setBonuses) {
    const count = counts.get(def.color) ?? 0;
    const bonus = activeBonusPercent(count, def.thresholds);
    if (bonus !== null) {
      activeSetBonuses.push({ color: def.color, bonusPercent: bonus });
    }
  }

  return {
    slots,
    activeSetBonuses,
    flatTotals: sumEmblemFlats(slots),
  };
}
