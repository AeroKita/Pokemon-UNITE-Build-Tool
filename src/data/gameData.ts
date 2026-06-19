// Single load + validation of the game-data bundle, with lookup maps.
// Imported once; the rest of the app reads from here.

import bundled from "./patch-current.json";
import { loadBundle } from "./loadBundle";
import { activeRaw, clearDataCache, refreshDataInBackground } from "./dataSource";
import { ZodError } from "zod";
import type { Pokemon, HeldItem, BattleItem, Emblem } from "../types";

function loadActiveBundle() {
  try {
    return loadBundle(activeRaw(bundled));
  } catch (e) {
    if (e instanceof ZodError) {
      clearDataCache();
      return loadBundle(bundled);
    }
    throw e;
  }
}

export const bundle = loadActiveBundle();

if (typeof window !== "undefined") {
  void refreshDataInBackground(bundle.lastUpdated, (patch) =>
    window.dispatchEvent(new CustomEvent("unite-data-updated", { detail: { patch } })),
  );
}

export const pokemonList: Pokemon[] = [...bundle.pokemon].sort((a, b) =>
  a.displayName.localeCompare(b.displayName),
);
export const heldItems: HeldItem[] = [...bundle.heldItems].sort((a, b) =>
  a.displayName.localeCompare(b.displayName),
);
export const battleItems: BattleItem[] = [...(bundle.battleItems ?? [])].sort((a, b) =>
  a.displayName.localeCompare(b.displayName),
);
export const emblems: Emblem[] = bundle.emblems;
export const setBonuses = bundle.setBonuses;

export const pokemonById = new Map(bundle.pokemon.map((p) => [p.id, p]));
export const heldItemById = new Map(bundle.heldItems.map((i) => [i.id, i]));
export const battleItemById = new Map((bundle.battleItems ?? []).map((i) => [i.id, i]));
export const emblemById = new Map(bundle.emblems.map((e) => [e.id, e]));

/** Item grade we model (UNITE held items: grades 1–40; in-game cap is 40). */
export const ITEM_GRADE_MAX = 40;
export const ITEM_GRADE_DEFAULT = 40;

/** Mega Stones & Rusted Sword have no per-grade stats → no grade/level to set. */
export function isUniqueHeldItem(item: HeldItem): boolean {
  return Object.keys(item.statsByGrade).length === 0;
}
