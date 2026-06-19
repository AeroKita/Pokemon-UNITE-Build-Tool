/**
 * Regression tests for applying emblem optimizer search results to the loadout.
 *
 * Verifies that SearchResult picks map to valid EmblemPick[] that resolve in
 * gameData and survive worker-style structured-clone round-trips.
 */

import { describe, it, expect } from "vitest";
import { emblems, emblemById, setBonuses, pokemonList } from "../../../data/gameData";
import { buildPool } from "../pool";
import { runSearch } from "../orchestrator";
import { deriveBasicObjective, basicSearchOptions } from "../basicObjective";
import { emptyLoadout, normalizeLoadout } from "../../../state/loadout";
import type { EmblemPick } from "../../../state/loadout";
import type { SearchResult } from "../types";
import { reducer } from "../../../state/store";

/** Mirror of EmblemOptimizer.emblemPicksFromResult */
function emblemPicksFromResult(result: SearchResult | null | undefined): EmblemPick[] {
  if (!result?.picks?.length) return [];
  return result.picks.flatMap((slot) => {
    const emblemId = slot.emblem?.id;
    if (!emblemId || !slot.grade) return [];
    return [{ emblemId, grade: slot.grade }];
  });
}

function applyReducer(
  loadout: ReturnType<typeof emptyLoadout>,
  emblemsToApply: EmblemPick[],
  level = 15,
) {
  return normalizeLoadout({
    ...loadout,
    level,
    emblems: emblemsToApply.slice(0, 10),
  });
}

describe("apply optimizer results to loadout", () => {
  const pokemon = pokemonList.find((p) => p.role === "AllRounder") ?? pokemonList[0];
  const pool = buildPool(
    emblems,
    { useOwned: false, mixedGrades: true, allowedGrades: new Set(["gold", "silver", "bronze"]) },
    new Set(),
  );

  it("maps search picks to 10 resolvable emblem IDs", async () => {
    const objective = deriveBasicObjective(pokemon, 15, emblems, pokemonList);
    const options = basicSearchOptions(objective);
    const result = await runSearch({ pool, options, setBonuses, effort: "quick" });
    expect(result).not.toBeNull();
    expect(result!.picks).toHaveLength(10);

    const picks = emblemPicksFromResult(result);
    expect(picks).toHaveLength(10);
    expect(picks.every((p) => emblemById.has(p.emblemId))).toBe(true);

    const next = applyReducer(emptyLoadout(pokemon.id), picks, 12);
    expect(next.emblems).toHaveLength(10);
    expect(next.level).toBe(12);
    expect(next.emblems.every((p) => emblemById.has(p.emblemId))).toBe(true);
  });

  it("survives structured-clone round-trip (worker postMessage simulation)", async () => {
    const objective = deriveBasicObjective(pokemon, 15, emblems, pokemonList);
    const options = basicSearchOptions(objective);
    const result = await runSearch({ pool, options, setBonuses, effort: "quick" });
    expect(result).not.toBeNull();

    const cloned = structuredClone(result!) as SearchResult;
    const picks = emblemPicksFromResult(cloned);
    expect(picks).toHaveLength(10);
    expect(picks.every((p) => typeof p.emblemId === "string" && p.emblemId.length > 0)).toBe(true);

    const next = applyReducer(emptyLoadout(pokemon.id), picks);
    expect(next.emblems).toHaveLength(10);
  });
});

describe("applyBuild reducer — separable & composable applies", () => {
  const samplePicks: EmblemPick[] = Array.from({ length: 10 }, () => {
    const e = emblems[0];
    return { emblemId: e.id, grade: "gold" as const };
  });
  const itemIds = ["muscle-band", "scope-lens", "razor-claw"];

  it("emblems-only apply leaves held items untouched", () => {
    const start = {
      ...emptyLoadout("pikachu"),
      heldItemIds: ["xattack-existing", null, null] as (string | null)[],
    };
    const next = reducer(start, { type: "applyBuild", level: 12, emblems: samplePicks });
    expect(next.emblems).toHaveLength(10);
    expect(next.level).toBe(12);
    // Held items are preserved (note: the placeholder id is dropped by
    // normalizeLoadout's sanitizer only if it isn't a string; it's a string here).
    expect(next.heldItemIds[0]).toBe("xattack-existing");
  });

  it("held-items-only apply leaves emblems untouched", () => {
    const start = { ...emptyLoadout("pikachu"), emblems: samplePicks };
    const next = reducer(start, { type: "applyBuild", level: 8, heldItemIds: itemIds });
    expect(next.heldItemIds).toEqual(itemIds);
    expect(next.level).toBe(8);
    expect(next.emblems).toHaveLength(10);
  });

  it("emblems then held items composes into one loadout with both", () => {
    let state = emptyLoadout("pikachu");
    state = reducer(state, { type: "applyBuild", level: 15, emblems: samplePicks });
    state = reducer(state, { type: "applyBuild", level: 15, heldItemIds: itemIds });
    expect(state.emblems).toHaveLength(10);
    expect(state.heldItemIds).toEqual(itemIds);
    expect(state.level).toBe(15);
  });

  it("applying held items does NOT overwrite previously applied emblems", () => {
    let state = emptyLoadout("pikachu");
    state = reducer(state, { type: "applyBuild", emblems: samplePicks });
    const emblemsAfterFirst = state.emblems;
    state = reducer(state, { type: "applyBuild", heldItemIds: itemIds });
    expect(state.emblems).toEqual(emblemsAfterFirst);
  });

  it("apply-all in a single dispatch sets both and syncs level once", () => {
    const next = reducer(emptyLoadout("pikachu"), {
      type: "applyBuild",
      level: 10,
      emblems: samplePicks,
      heldItemIds: itemIds,
    });
    expect(next.emblems).toHaveLength(10);
    expect(next.heldItemIds).toEqual(itemIds);
    expect(next.level).toBe(10);
  });
});
