// Move-selection helpers: a Pokémon's Move 1 / Move 2 each have a base skill
// and a set of upgrade options; the player picks one upgrade per slot as the
// "final move". These pure helpers resolve the effective final move for a slot
// given the player's choice (with a sensible default), and are shared by the
// Moves card, the Builds panel, and the store.

import type { Move, Pokemon } from "../types";

export type FinalSlot = "move1" | "move2";

/** The base (pre-upgrade) skill for a slot, if any. */
export function baseMove(pokemon: Pokemon, slot: FinalSlot): Move | undefined {
  return pokemon.moves.find((m) => m.slot === slot && !m.isUpgrade);
}

/** The upgrade options the player chooses between for a slot (the "final moves"). */
export function upgradeOptions(pokemon: Pokemon, slot: FinalSlot): Move[] {
  return pokemon.moves.filter((m) => m.slot === slot && m.isUpgrade);
}

/** The move name the top Recommended build picks for a slot, if it maps to an upgrade. */
function recommendedMoveName(pokemon: Pokemon, slot: FinalSlot): string | undefined {
  const names = pokemon.builds?.find((b) => b.moves && b.moves.length > 0)?.moves;
  if (!names) return undefined;
  const slotNames = new Set(upgradeOptions(pokemon, slot).map((m) => m.name));
  return names.find((n) => slotNames.has(n));
}

/**
 * The effective final move shown/selected for a slot given the player's chosen
 * id. Falls back to: the top Recommended build's pick → the first upgrade
 * option → the base skill (for the rare slot with no upgrades).
 */
export function resolveFinalMove(
  pokemon: Pokemon,
  slot: FinalSlot,
  chosenId?: string | null,
): Move | undefined {
  const ups = upgradeOptions(pokemon, slot);
  if (chosenId) {
    const chosen = ups.find((m) => m.id === chosenId);
    if (chosen) return chosen;
  }
  const recName = recommendedMoveName(pokemon, slot);
  if (recName) {
    const rec = ups.find((m) => m.name === recName);
    if (rec) return rec;
  }
  return ups[0] ?? baseMove(pokemon, slot);
}

/** Default { move1Id, move2Id } for a Pokémon (top Recommended build, else first upgrades). */
export function defaultFinalMoveIds(pokemon: Pokemon): {
  move1Id: string | null;
  move2Id: string | null;
} {
  return {
    move1Id: resolveFinalMove(pokemon, "move1")?.id ?? null,
    move2Id: resolveFinalMove(pokemon, "move2")?.id ?? null,
  };
}

/**
 * Resolve a build's final-move *names* into { move1Id, move2Id } for this
 * Pokémon, filling any gap with the derived default. Used when applying a build.
 */
export function moveIdsFromNames(
  pokemon: Pokemon,
  names?: string[],
): { move1Id: string | null; move2Id: string | null } {
  const upgrades = pokemon.moves.filter((m) => m.isUpgrade);
  const byName = new Map(upgrades.map((m) => [m.name, m]));
  let move1Id: string | null = null;
  let move2Id: string | null = null;
  for (const n of names ?? []) {
    const m = byName.get(n);
    if (!m) continue;
    if (m.slot === "move1") move1Id = m.id;
    else if (m.slot === "move2") move2Id = m.id;
  }
  const def = defaultFinalMoveIds(pokemon);
  return { move1Id: move1Id ?? def.move1Id, move2Id: move2Id ?? def.move2Id };
}
