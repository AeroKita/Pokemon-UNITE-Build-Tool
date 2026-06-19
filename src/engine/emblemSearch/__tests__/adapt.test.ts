import { describe, it, expect } from "vitest";
import { emblems } from "../../../data/gameData";
import {
  buildCandidatePool,
  distinctPokemonCount,
  groupByPokemon,
  GRADE_ORDER,
} from "../adapt";
import { approximateBuildCount } from "../pool";

describe("adapt — candidate pool from real 258-emblem dataset", () => {
  it("produces 258 gold candidates from full dataset", () => {
    const pool = buildCandidatePool(emblems, { grades: ["gold"] });
    expect(pool).toHaveLength(258);
  });

  it("produces 3× candidates when all three grades are requested", () => {
    // goldOnly emblems only produce 1 variant (gold); the rest produce 3
    const pool = buildCandidatePool(emblems, { grades: ["gold", "silver", "bronze"] });
    expect(pool.length).toBeGreaterThan(258);
    expect(pool.length).toBeLessThanOrEqual(258 * 3);
  });

  it("all candidates have a valid pokemonName and grade", () => {
    const pool = buildCandidatePool(emblems, { grades: ["gold"] });
    for (const c of pool) {
      expect(c.pokemonName).toBeTruthy();
      expect(GRADE_ORDER).toContain(c.grade);
    }
  });

  it("candidates have at least one color", () => {
    const pool = buildCandidatePool(emblems, { grades: ["gold"] });
    for (const c of pool) {
      expect(c.colors.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("owned pool only includes owned emblems", () => {
    // Own 10 emblems (first 10 in dataset) at gold
    const owned = new Set(emblems.slice(0, 10).map((e) => `${e.id}:gold`));
    const pool = buildCandidatePool(emblems, { ownedKeys: owned });
    expect(pool).toHaveLength(10);
    expect(pool.every((c) => c.grade === "gold")).toBe(true);
  });

  it("owned pool uses best grade (gold > silver > bronze)", () => {
    const e = emblems[0];
    // Own only bronze
    const owned = new Set([`${e.id}:bronze`]);
    const pool = buildCandidatePool(emblems, { ownedKeys: owned });
    expect(pool[0].grade).toBe("bronze");
    // Now own silver too — should return silver
    owned.add(`${e.id}:silver`);
    const pool2 = buildCandidatePool(emblems, { ownedKeys: owned });
    expect(pool2[0].grade).toBe("silver");
    // Now own gold — should return gold
    owned.add(`${e.id}:gold`);
    const pool3 = buildCandidatePool(emblems, { ownedKeys: owned });
    expect(pool3[0].grade).toBe("gold");
  });

  it("distinct pokemon count matches number of unique pokemonNames", () => {
    const pool = buildCandidatePool(emblems, { grades: ["gold"] });
    expect(distinctPokemonCount(pool)).toBe(258);
  });

  it("groupByPokemon returns sorted groups with the right variants", () => {
    // Pool with multi-grade emblems
    const pool = buildCandidatePool(emblems.slice(0, 5), { grades: ["gold", "silver", "bronze"] });
    const groups = groupByPokemon(pool);
    // Each group should correspond to exactly one Pokémon
    const names = groups.map((g) => g.name);
    expect(new Set(names).size).toBe(names.length);
    // Names should be in ascending order
    for (let i = 1; i < names.length; i++) {
      expect(names[i - 1].localeCompare(names[i])).toBeLessThanOrEqual(0);
    }
    // Each group has ≥1 variants
    for (const g of groups) {
      expect(g.variants.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("approximateBuildCount C(258,10) is large", () => {
    const pool = buildCandidatePool(emblems, { grades: ["gold"] });
    const count = approximateBuildCount(pool, 10);
    // C(258,10) is approximately 10 trillion
    expect(count).toBeGreaterThan(1_000_000_000_000n);
  });

  it("approximateBuildCount returns 0 for pool smaller than slots", () => {
    const pool = buildCandidatePool(emblems.slice(0, 5), { grades: ["gold"] });
    const count = approximateBuildCount(pool, 10);
    expect(count).toBe(0n);
  });
});

describe("adapt — stat fidelity", () => {
  it("gold candidate stats match statsByGrade.gold in the source", () => {
    const e = emblems[0];
    const pool = buildCandidatePool([e], { grades: ["gold"] });
    expect(pool[0].stats).toEqual(e.statsByGrade.gold);
  });

  it("silver candidate stats match statsByGrade.silver", () => {
    const e = emblems.find((em) => !em.goldOnly)!;
    const pool = buildCandidatePool([e], { grades: ["silver"] });
    expect(pool[0].stats).toEqual(e.statsByGrade.silver);
  });

  it("goldOnly emblems are excluded from silver grade", () => {
    const goldOnly = emblems.filter((e) => e.goldOnly);
    if (!goldOnly.length) return; // no goldOnly in dataset → skip
    const pool = buildCandidatePool(goldOnly, { grades: ["silver"] });
    expect(pool).toHaveLength(0);
  });
});
