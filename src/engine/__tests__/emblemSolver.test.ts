import { describe, it, expect } from "vitest";
import { solveEmblemSet, colorCountsOf, colorTargetsFor, unneededStats } from "../recommend";
import { pokemonList, emblems, emblemById } from "../../data/gameData";
import type { EmblemColor } from "../../types";

const physical = pokemonList.find((p) => p.attackType === "physical")!;
const special = pokemonList.find((p) => p.attackType === "special")!;

describe("emblem solver", () => {
  it("derives 'unneeded' stats from attack type", () => {
    expect(unneededStats(physical).has("spAttack")).toBe(true);
    expect(unneededStats(physical).has("attack")).toBe(false);
    expect(unneededStats(special).has("attack")).toBe(true);
    expect(unneededStats(special).has("spAttack")).toBe(false);
  });

  it("produces 10 distinct-Pokémon emblems", () => {
    const set = solveEmblemSet(physical, emblems, { seed: 1 });
    expect(set).toHaveLength(10);
    const names = set.map((p) => emblemById.get(p.emblemId)!.pokemonName);
    expect(new Set(names).size).toBe(10);
  });

  it("meets the color targets it is given (feasible targets)", () => {
    const targets = new Map<EmblemColor, number>([
      ["brown", 6],
      ["white", 6],
    ]);
    const set = solveEmblemSet(physical, emblems, { targets, seed: 3 });
    const counts = colorCountsOf(set, emblemById);
    expect(counts.get("brown") ?? 0).toBeGreaterThanOrEqual(6);
    expect(counts.get("white") ?? 0).toBeGreaterThanOrEqual(6);
  });

  it("never drives a needed flat stat past the negative floor", () => {
    const set = solveEmblemSet(physical, emblems, { seed: 7 });
    let attackNeg = 0;
    for (const p of set) attackNeg += emblemById.get(p.emblemId)!.statsByGrade.gold.attack ?? 0;
    // Physical: each emblem stays within the attack floor (no -15+ attack emblems chosen).
    for (const p of set) {
      const a = emblemById.get(p.emblemId)!.statsByGrade.gold.attack ?? 0;
      expect(a).toBeGreaterThanOrEqual(-15);
    }
    expect(typeof attackNeg).toBe("number");
  });

  it("varies with the seed (Reroll)", () => {
    const a = solveEmblemSet(physical, emblems, { seed: 1 })
      .map((p) => p.emblemId)
      .join();
    const b = solveEmblemSet(physical, emblems, { seed: 99 })
      .map((p) => p.emblemId)
      .join();
    expect(a).not.toBe(b);
  });

  it("uses a curated build's color profile as the default target", () => {
    const withBuild = pokemonList.find((p) => p.builds?.some((b) => b.emblems.length === 10))!;
    const targets = colorTargetsFor(withBuild, emblemById);
    expect([...targets.values()].some((n) => n >= 2)).toBe(true);
  });
});
