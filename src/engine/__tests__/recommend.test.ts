import { describe, it, expect } from "vitest";
import {
  priorityWeights,
  scoreHeldItem,
  recommendBuild,
  solveOwnedEmblemSet,
  bestOwnedGrade,
} from "../recommend";
import {
  pokemonList,
  heldItems,
  heldItemById,
  setBonuses,
  emblems as allEmblems,
} from "../../data/gameData";
import type { StatBlock } from "../../types";

const physical = pokemonList.find((p) => p.attackType === "physical")!;
// A special *Attacker* prioritises Sp. Atk (a special Supporter would weight CDR).
const special =
  pokemonList.find((p) => p.attackType === "special" && p.role === "Attacker") ??
  pokemonList.find((p) => p.attackType === "special")!;

function combinedStat(ids: string[], stat: keyof StatBlock): number {
  return ids.reduce((sum, id) => sum + (heldItemById.get(id)?.statsByGrade[40]?.[stat] ?? 0), 0);
}

describe("recommendation engine", () => {
  it("weights offense by attack type", () => {
    expect(priorityWeights(physical).attack).toBeGreaterThan(0);
    expect(priorityWeights(special).spAttack).toBeGreaterThan(0);
    expect(priorityWeights(physical).spAttack ?? 0).toBe(0);
  });

  it("recommends attack-oriented items for a physical Pokémon", () => {
    const rec = recommendBuild(physical, heldItems, setBonuses);
    expect(rec.heldItemIds).toHaveLength(3);
    expect(combinedStat(rec.heldItemIds, "attack")).toBeGreaterThan(
      combinedStat(rec.heldItemIds, "spAttack"),
    );
    expect(rec.emblemColors[0].color).toBe("brown");
  });

  it("recommends sp. atk-oriented items for a special Pokémon", () => {
    const rec = recommendBuild(special, heldItems, setBonuses);
    expect(combinedStat(rec.heldItemIds, "spAttack")).toBeGreaterThan(
      combinedStat(rec.heldItemIds, "attack"),
    );
    expect(rec.emblemColors[0].color).toBe("green");
  });

  it("picks X-Attack for offense, Eject Button for defenders/supporters", () => {
    const defender = pokemonList.find((p) => p.role === "Defender");
    expect(recommendBuild(physical, heldItems, setBonuses).battleItemId).toBe("x-attack");
    if (defender)
      expect(recommendBuild(defender, heldItems, setBonuses).battleItemId).toBe("eject-button");
  });

  it("scores a pure-attack item above a pure-defense item for an attacker", () => {
    const w = priorityWeights(physical);
    const muscle = heldItemById.get("muscle-band");
    const focus = heldItemById.get("focus-band");
    if (muscle && focus) expect(scoreHeldItem(muscle, w)).toBeGreaterThan(scoreHeldItem(focus, w));
  });
});

describe("Your Emblems (owned) solver", () => {
  it("reports the best owned grade (gold > silver > bronze) or null", () => {
    const owned = new Set(["a:silver", "a:bronze", "b:gold"]);
    expect(bestOwnedGrade("a", owned)).toBe("silver");
    expect(bestOwnedGrade("b", owned)).toBe("gold");
    expect(bestOwnedGrade("c", owned)).toBeNull();
  });

  it("returns nothing when the player owns no emblems", () => {
    expect(solveOwnedEmblemSet(physical, allEmblems, new Set())).toHaveLength(0);
  });

  it("only uses owned emblems, at their owned grade, max 10, distinct Pokémon", () => {
    const pick = allEmblems.slice(0, 14);
    const owned = new Set([
      ...pick.slice(0, 12).map((e) => `${e.id}:gold`),
      `${pick[12].id}:silver`,
      `${pick[13].id}:bronze`,
    ]);
    const set = solveOwnedEmblemSet(physical, allEmblems, owned, { seed: 3 });
    expect(set.length).toBeGreaterThan(0);
    expect(set.length).toBeLessThanOrEqual(10);
    const names = new Set<string>();
    for (const p of set) {
      expect(owned.has(`${p.emblemId}:${p.grade}`)).toBe(true); // owned at that grade
      const e = allEmblems.find((x) => x.id === p.emblemId)!;
      expect(names.has(e.pokemonName)).toBe(false); // distinct Pokémon
      names.add(e.pokemonName);
    }
  });
});
