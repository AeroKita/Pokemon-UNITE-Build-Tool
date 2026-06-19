// Shared test fixtures: synthetic emblems and the real sample bundle.

import type { Emblem, EmblemColor, EmblemSlot, StatBlock } from "../../types";
import { loadBundle } from "../../data/loadBundle";
import rawBundle from "../../data/example-lucario.json";

export const bundle = loadBundle(rawBundle);

export const lucario = bundle.pokemon.find((p) => p.id === "lucario")!;
export const floatStone = bundle.heldItems.find((i) => i.id === "float-stone")!;
export const attackWeight = bundle.heldItems.find((i) => i.id === "attack-weight")!;
export const diglett = bundle.emblems.find((e) => e.id === "diglett")!;
export const aerodactyl = bundle.emblems.find((e) => e.id === "aerodactyl")!;

/** Synthetic emblem with identical stats at every grade. */
export function makeEmblem(
  pokemonName: string,
  colors: EmblemColor[],
  stats: Partial<StatBlock> = {},
): Emblem {
  return {
    id: pokemonName.toLowerCase(),
    pokemonName,
    colors,
    iconAsset: `test/${pokemonName}.png`,
    statsByGrade: { bronze: stats, silver: stats, gold: stats },
  };
}

export function gold(emblem: Emblem): EmblemSlot {
  return { emblem, grade: "gold" };
}

/** n distinct same-colored emblems, each with the same flat stats. */
export function distinctEmblems(
  n: number,
  colors: EmblemColor[],
  stats: Partial<StatBlock> = {},
): EmblemSlot[] {
  return Array.from({ length: n }, (_, i) =>
    gold(makeEmblem(`Test${colors.join("-")}${i}`, colors, stats)),
  );
}

export const OUT_OF_COMBAT = { inCombat: false, goalsScored: 0 };
export const IN_COMBAT = { inCombat: true, goalsScored: 0 };
