/**
 * Tests for Basic-mode auto-objective derivation.
 *
 * Invariants:
 *  1. Physical attacker → attack-dominant stat priorities, brown in color targets
 *  2. Special attacker → spAttack-dominant priorities, green in color targets
 *  3. Defender         → hp + defense priorities, white in color targets
 *  4. basicSearchOptions builds valid SearchOptions for maximize mode with pokemon-aware scoring
 *  5. topPriorityLabels: returns top-N labels in descending weight order
 */

import { describe, it, expect } from "vitest";
import {
  deriveBasicObjective,
  basicSearchOptions,
  buildBasicPool,
  BASIC_POOL_DEFAULTS,
  topPriorityLabels,
} from "../basicObjective";
import type { EmblemColor, Pokemon } from "../../../types";
import { makeEmblem } from "../../__tests__/fixtures";
import { buildPool } from "../pool";

// ---------------------------------------------------------------------------
// Minimal fixtures
// ---------------------------------------------------------------------------

function makeStats() {
  return {
    hp: 5000, attack: 200, defense: 100, spAttack: 80, spDefense: 100,
    critRate: 0, cdr: 0, lifesteal: 0, spLifesteal: 0, attackSpeed: 0.4, moveSpeed: 3700,
  };
}

function makePokemon(
  id: string,
  attackType: "physical" | "special" | "hybrid",
  role: "Attacker" | "Defender" | "Supporter" | "AllRounder" | "Speedster",
): Pokemon {
  return {
    id,
    displayName: id,
    role,
    attackType,
    difficulty: 1,
    imageAsset: "",
    iconAsset: "",
    evolutions: [],
    baseStatsByLevel: Array.from({ length: 15 }, () => ({ ...makeStats() })),
    moves: [],
    passiveAbility: { id: "p", name: "", description: "", effects: [] },
  };
}

// ---------------------------------------------------------------------------
// Test 1-3: Auto-derived priorities by archetype
// ---------------------------------------------------------------------------

describe("deriveBasicObjective — stat priorities", () => {
  const emptyEmblems: Parameters<typeof deriveBasicObjective>[2] = [];

  it("physical Attacker: attack weight > spAttack weight", () => {
    const pokemon = makePokemon("lucario", "physical", "Attacker");
    const obj = deriveBasicObjective(pokemon, 15, emptyEmblems);

    expect(obj.priorities.attack ?? 0).toBeGreaterThan(obj.priorities.spAttack ?? 0);
    expect(obj.priorities.attack ?? 0).toBeGreaterThan(0);
  });

  it("special Attacker: spAttack weight > attack weight", () => {
    const pokemon = makePokemon("gardevoir", "special", "Attacker");
    const obj = deriveBasicObjective(pokemon, 15, emptyEmblems);

    expect(obj.priorities.spAttack ?? 0).toBeGreaterThan(obj.priorities.attack ?? 0);
    expect(obj.priorities.spAttack ?? 0).toBeGreaterThan(0);
  });

  it("Defender: hp and defense both weighted", () => {
    const pokemon = makePokemon("snorlax", "physical", "Defender");
    const obj = deriveBasicObjective(pokemon, 15, emptyEmblems);

    expect(obj.priorities.hp ?? 0).toBeGreaterThan(0);
    expect(obj.priorities.defense ?? 0).toBeGreaterThan(0);
  });

  it("Supporter: cdr heavily weighted", () => {
    const pokemon = makePokemon("blissey", "special", "Supporter");
    const obj = deriveBasicObjective(pokemon, 15, emptyEmblems);

    expect(obj.priorities.cdr ?? 0).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Test: Color targets by archetype (no curated build)
// ---------------------------------------------------------------------------

describe("deriveBasicObjective — color targets", () => {
  const emptyEmblems: Parameters<typeof deriveBasicObjective>[2] = [];

  it("physical attacker: brown (attack) in color targets", () => {
    const pokemon = makePokemon("lucario", "physical", "Attacker");
    const obj = deriveBasicObjective(pokemon, 15, emptyEmblems);

    expect(obj.colorTargets.has("brown")).toBe(true);
    expect((obj.colorTargets.get("brown") ?? 0)).toBeGreaterThan(0);
  });

  it("special attacker: green (spAttack) in color targets", () => {
    const pokemon = makePokemon("gardevoir", "special", "Attacker");
    const obj = deriveBasicObjective(pokemon, 15, emptyEmblems);

    expect(obj.colorTargets.has("green")).toBe(true);
  });

  it("Defender: white (HP) in color targets", () => {
    const pokemon = makePokemon("snorlax", "physical", "Defender");
    const obj = deriveBasicObjective(pokemon, 15, emptyEmblems);

    expect(obj.colorTargets.has("white")).toBe(true);
  });

  it("Supporter: black (CDR) in color targets", () => {
    const pokemon = makePokemon("blissey", "special", "Supporter");
    const obj = deriveBasicObjective(pokemon, 15, emptyEmblems);

    expect(obj.colorTargets.has("black")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test: Pokemon scoring context
// ---------------------------------------------------------------------------

describe("deriveBasicObjective — pokemonContext", () => {
  it("pokemonContext contains correct pokemonId and level", () => {
    const pokemon = makePokemon("lucario", "physical", "Attacker");
    const obj = deriveBasicObjective(pokemon, 10, []);

    expect(obj.pokemonContext.pokemonId).toBe("lucario");
    expect(obj.pokemonContext.level).toBe(10);
    expect(obj.pokemonContext.baseStats).toBeDefined();
  });

  it("baseStats matches the level-indexed stat block", () => {
    const pokemon = makePokemon("lucario", "physical", "Attacker");
    const obj = deriveBasicObjective(pokemon, 5, []);

    // baseStats should be the stats at level 5 (index 4)
    expect(obj.pokemonContext.baseStats).toEqual(pokemon.baseStatsByLevel[4]);
  });
});

// ---------------------------------------------------------------------------
// Test: basicSearchOptions
// ---------------------------------------------------------------------------

describe("basicSearchOptions", () => {
  it("returns maximize mode with pokemon-aware scoring", () => {
    const pokemon = makePokemon("lucario", "physical", "Attacker");
    const obj = deriveBasicObjective(pokemon, 15, []);
    const opts = basicSearchOptions(obj);

    expect(opts.mode).toBe("maximize");
    expect(opts.scoringMode).toBe("pokemon");
    expect(opts.pokemonContext).toBeDefined();
    expect(opts.colorBonuses).toBe(true);
    expect(opts.slots).toBe(10);
  });

  it("defaults to no hard color constraints when none are supplied", () => {
    const pokemon = makePokemon("lucario", "physical", "Attacker");
    const obj = deriveBasicObjective(pokemon, 15, []);
    const opts = basicSearchOptions(obj);

    expect(opts.colorConstraints).toBeNull();
  });

  it("enforces hard color constraints when supplied (Expert-equivalent path)", () => {
    const pokemon = makePokemon("lucario", "physical", "Attacker");
    const obj = deriveBasicObjective(pokemon, 15, []);
    const constraints = new Map<EmblemColor, number>([["brown", 6], ["white", 6]]);
    const opts = basicSearchOptions(obj, constraints);

    expect(opts.colorConstraints).not.toBeNull();
    expect(opts.colorConstraints!.get("brown")).toBe(6);
    expect(opts.colorConstraints!.get("white")).toBe(6);
  });

  it("priorities match the pokemon's role-based weights", () => {
    const pokemon = makePokemon("lucario", "physical", "Attacker");
    const obj = deriveBasicObjective(pokemon, 15, []);
    const opts = basicSearchOptions(obj);

    expect(opts.priorities.attack ?? 0).toBeGreaterThan(opts.priorities.spAttack ?? 0);
  });
});

// ---------------------------------------------------------------------------
// Test: buildBasicPool — pool source + grade filters
// ---------------------------------------------------------------------------

describe("buildBasicPool", () => {
  const emblems = [
    makeEmblem("OwnedA", ["brown"], { attack: 1 }),
    makeEmblem("OwnedB", ["white"], { attack: 1 }),
    makeEmblem("Unowned", ["green"], { attack: 1 }),
  ];
  const goldOnly = new Set<"gold" | "silver" | "bronze">(["gold"]);

  it("BASIC_POOL_DEFAULTS use owned inventory by default", () => {
    expect(BASIC_POOL_DEFAULTS.useOwned).toBe(true);
    expect(BASIC_POOL_DEFAULTS.mixedGrades).toBe(true);
    expect(BASIC_POOL_DEFAULTS.allowedGrades.has("bronze")).toBe(true);
    expect(BASIC_POOL_DEFAULTS.allowedGrades.has("silver")).toBe(true);
    expect(BASIC_POOL_DEFAULTS.allowedGrades.has("gold")).toBe(true);
    expect(BASIC_POOL_DEFAULTS.allowedGrades.size).toBe(3);
  });

  it("owned mode includes all owned grade keys regardless of allowedGrades", () => {
    const owned = new Set(["owneda:gold", "ownedb:silver"]);
    const pool = buildBasicPool(emblems, owned, {
      useOwned: true,
      mixedGrades: true,
      allowedGrades: goldOnly,
    });

    expect(pool).toHaveLength(2);
    for (const c of pool) {
      expect(owned.has(`${c.id}:${c.grade}`)).toBe(true);
    }
  });

  it("owned mode with all grades includes every owned variant", () => {
    const owned = new Set(["owneda:gold", "ownedb:silver"]);
    const pool = buildBasicPool(emblems, owned, {
      useOwned: true,
      mixedGrades: true,
      allowedGrades: new Set(["gold", "silver", "bronze"]),
    });

    expect(pool).toHaveLength(2);
    for (const c of pool) {
      expect(owned.has(`${c.id}:${c.grade}`)).toBe(true);
    }
    expect(pool.some((c) => c.id === "unowned")).toBe(false);
  });

  it("empty owned set → empty pool (no fallback to full dataset)", () => {
    expect(
      buildBasicPool(emblems, new Set(), {
        useOwned: true,
        mixedGrades: true,
        allowedGrades: goldOnly,
      }),
    ).toHaveLength(0);
  });

  it("mixedGrades=false → best owned grade only", () => {
    const owned = new Set(["owneda:bronze", "owneda:gold"]);
    const mixed = buildBasicPool(emblems, owned, {
      useOwned: true,
      mixedGrades: true,
      allowedGrades: new Set(["gold", "silver", "bronze"]),
    });
    const bestOnly = buildBasicPool(emblems, owned, {
      useOwned: true,
      mixedGrades: false,
      allowedGrades: new Set(["gold", "silver", "bronze"]),
    });

    expect(mixed.filter((c) => c.id === "owneda")).toHaveLength(2);
    expect(bestOnly.filter((c) => c.id === "owneda")).toHaveLength(1);
    expect(bestOnly[0].grade).toBe("gold");
  });

  it("useOwned=false uses the full dataset at allowed grades", () => {
    const owned = new Set(["owneda:gold"]);
    const ownedPool = buildBasicPool(emblems, owned, {
      useOwned: true,
      mixedGrades: true,
      allowedGrades: goldOnly,
    });
    const fullPool = buildBasicPool(emblems, owned, {
      useOwned: false,
      mixedGrades: true,
      allowedGrades: goldOnly,
    });

    expect(ownedPool.length).toBeLessThan(fullPool.length);
    expect(fullPool.length).toBe(3);
  });

  it("owned mode matches generic buildPool (no grade filter on owned)", () => {
    const owned = new Set(["owneda:gold", "ownedb:silver"]);
    const basic = buildBasicPool(emblems, owned, {
      useOwned: true,
      mixedGrades: true,
      allowedGrades: goldOnly,
    });
    const advancedOwned = buildPool(
      emblems,
      { useOwned: true, mixedGrades: true, allowedGrades: goldOnly },
      owned,
    );

    expect(basic).toHaveLength(2);
    expect(advancedOwned).toHaveLength(2);
    expect(basic.map((c) => `${c.id}:${c.grade}`).sort()).toEqual(
      advancedOwned.map((c) => `${c.id}:${c.grade}`).sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Test: topPriorityLabels
// ---------------------------------------------------------------------------

describe("topPriorityLabels", () => {
  it("returns labels in descending weight order", () => {
    const priorities = { attack: 4.5, hp: 2, cdr: 1 };
    const labels = topPriorityLabels(priorities, 3);

    expect(labels[0]).toBe("Attack"); // highest weight
    expect(labels).toHaveLength(3);
  });

  it("respects maxCount limit", () => {
    const priorities = { attack: 4, hp: 3, spAttack: 2, cdr: 1 };
    expect(topPriorityLabels(priorities, 2)).toHaveLength(2);
  });

  it("excludes zero-weight stats", () => {
    const priorities = { attack: 3, spAttack: 0, hp: 0 };
    const labels = topPriorityLabels(priorities, 4);
    expect(labels).toHaveLength(1); // only attack > 0
  });
});
