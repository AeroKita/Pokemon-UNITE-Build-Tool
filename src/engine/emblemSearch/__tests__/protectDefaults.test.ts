/**
 * Tests for the per-Pokémon protect-floor defaults derivation.
 *
 * Key invariants:
 *  1. A physically-dominant Pokémon (high attack relative to population)
 *     has "attack" in its derived protect floors.
 *  2. A specially-dominant Pokémon has "spAttack" in its protect floors.
 *  3. A bulk-dominant Pokémon (high HP/defense) has those in its protect floors.
 *  4. No more than MAX_PROTECT (2) stats are protected by default.
 *  5. Empty population → no protect floors (safe fallback).
 *  6. Single-Pokémon population → no protect floors (can't compute z-scores).
 *  7. Floor value is always 0 (don't let emblems net-reduce the stat).
 *  8. The protect penalty in evaluateLoadout changes the search result
 *     (a build that tanks a protected stat is penalised).
 *  9. deriveBasicObjective includes protectedFloors when allPokemon is passed.
 */

import { describe, it, expect } from "vitest";
import { deriveDefaultProtectedStats, deriveMobilityFloor, deriveProtectFloors } from "../protectDefaults";
import { deriveBasicObjective, basicSearchOptions } from "../basicObjective";
import { evaluateLoadout } from "../evaluate";
import { makeEmblem } from "../../__tests__/fixtures";
import { buildCandidatePool } from "../adapt";
import { loadBundle } from "../../../data/loadBundle";
import rawPatch from "../../../data/patch-current.json";
import type { Pokemon, StatBlock } from "../../../types";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeStats(overrides: Partial<StatBlock> = {}): StatBlock {
  return {
    hp: 5000, attack: 200, defense: 100, spAttack: 80, spDefense: 100,
    critRate: 0, cdr: 0, lifesteal: 0, spLifesteal: 0,
    attackSpeed: 0.4, moveSpeed: 3700,
    ...overrides,
  };
}

function makePokemon(
  id: string,
  statsAt15: Partial<StatBlock> = {},
  overrides: Partial<Pick<Pokemon, "role" | "attackType">> = {},
): Pokemon {
  return {
    id,
    displayName: id,
    role: overrides.role ?? "Attacker",
    attackType: overrides.attackType ?? "physical",
    difficulty: 1,
    imageAsset: "",
    iconAsset: "",
    evolutions: [],
    baseStatsByLevel: Array.from({ length: 15 }, () => makeStats(statsAt15)),
    moves: [],
    passiveAbility: { id: "p", name: "", description: "", effects: [] },
  };
}

// ---------------------------------------------------------------------------
// Population: 10 Pokémon with baseline stats + 1 specialist
// ---------------------------------------------------------------------------

const BASELINE: Partial<StatBlock> = {
  hp: 5000, attack: 200, spAttack: 80, defense: 100, spDefense: 100,
};
const POP_BASE = Array.from({ length: 10 }, (_, i) =>
  makePokemon(`base${i}`, BASELINE),
);

// ---------------------------------------------------------------------------
// deriveDefaultProtectedStats
// ---------------------------------------------------------------------------

describe("deriveDefaultProtectedStats", () => {
  it("[PROT-1] physical-dominant Pokémon: attack protected", () => {
    // High attack relative to population average
    const attacker = makePokemon("attacker", { ...BASELINE, attack: 500 });
    const pop = [...POP_BASE, attacker];
    const floors = deriveDefaultProtectedStats(attacker, pop, 15);
    expect(Object.keys(floors)).toContain("attack");
  });

  it("[PROT-2] special-dominant Pokémon: spAttack protected", () => {
    const caster = makePokemon("caster", { ...BASELINE, spAttack: 400 });
    const pop = [...POP_BASE, caster];
    const floors = deriveDefaultProtectedStats(caster, pop, 15);
    expect(Object.keys(floors)).toContain("spAttack");
  });

  it("[PROT-3] bulk Pokémon: hp and/or defense protected", () => {
    const tank = makePokemon("tank", { ...BASELINE, hp: 12000, defense: 300 });
    const pop = [...POP_BASE, tank];
    const floors = deriveDefaultProtectedStats(tank, pop, 15);
    const protectedStats = Object.keys(floors);
    expect(protectedStats.some((s) => s === "hp" || s === "defense")).toBe(true);
  });

  it("[PROT-4] at most 2 stats protected (MAX_PROTECT guard)", () => {
    const omni = makePokemon("omni", { hp: 12000, attack: 500, spAttack: 400, defense: 300, spDefense: 300 });
    const pop = [...POP_BASE, omni];
    const floors = deriveDefaultProtectedStats(omni, pop, 15);
    expect(Object.keys(floors).length).toBeLessThanOrEqual(2);
  });

  it("[PROT-5] empty population → empty floors (safe fallback)", () => {
    const poke = makePokemon("solo", BASELINE);
    expect(deriveDefaultProtectedStats(poke, [], 15)).toEqual({});
  });

  it("[PROT-6] single-Pokémon population → empty floors (can't compute z-score)", () => {
    const poke = makePokemon("solo", BASELINE);
    expect(deriveDefaultProtectedStats(poke, [poke], 15)).toEqual({});
  });

  it("[PROT-7] floor value is always 0", () => {
    const attacker = makePokemon("attacker2", { ...BASELINE, attack: 500 });
    const pop = [...POP_BASE, attacker];
    const floors = deriveDefaultProtectedStats(attacker, pop, 15);
    for (const val of Object.values(floors)) {
      expect(val).toBe(0);
    }
  });

  it("[PROT-8] average Pokémon has no clearly protected stats (below z-threshold)", () => {
    // A Pokémon exactly at the population mean should get no protections
    const average = makePokemon("average", BASELINE);
    const pop = [...POP_BASE, average];
    const floors = deriveDefaultProtectedStats(average, pop, 15);
    // Average stat = same as everyone else → z-score = 0 → below Z_THRESHOLD
    expect(Object.keys(floors).length).toBe(0);
  });

  it("[PROT-8b] offense fallback protects primary attack below z-threshold", () => {
    // Moderate attack (z between 0.25 and 0.4) on an offensive role → attack protected
    const lucarioLike = makePokemon(
      "lucario-like",
      { ...BASELINE, attack: 320, spAttack: 80 },
      { role: "AllRounder", attackType: "physical" },
    );
    const pop = [...POP_BASE, lucarioLike];
    const floors = deriveDefaultProtectedStats(lucarioLike, pop, 15);
    expect(Object.keys(floors)).toEqual(["attack"]);
  });

  it("[PROT-8c] glass Attacker with standout spAttack does not protect average HP", () => {
    const glass = makePokemon(
      "glass",
      { ...BASELINE, spAttack: 400 },
      { role: "Attacker", attackType: "special" },
    );
    const pop = [...POP_BASE, glass];
    const floors = deriveDefaultProtectedStats(glass, pop, 15);
    expect(Object.keys(floors)).toEqual(["spAttack"]);
  });
});

// ---------------------------------------------------------------------------
// deriveMobilityFloor (role-based move-speed guard)
// ---------------------------------------------------------------------------

describe("deriveMobilityFloor", () => {
  it("[MOB-1] mobile roles get a moveSpeed floor of 0", () => {
    for (const role of ["Attacker", "Speedster", "AllRounder"] as const) {
      const poke = makePokemon(`m-${role}`, BASELINE, { role });
      expect(deriveMobilityFloor(poke)).toEqual({ moveSpeed: 0 });
    }
  });

  it("[MOB-2] stationary roles get no move-speed floor", () => {
    for (const role of ["Defender", "Supporter"] as const) {
      const poke = makePokemon(`s-${role}`, BASELINE, { role });
      expect(deriveMobilityFloor(poke)).toEqual({});
    }
  });

  it("[MOB-3] does not interfere with z-score defining-stat picks", () => {
    // Mobility floor is derived separately, so the base derivation is unchanged.
    const attacker = makePokemon("attacker-mob", { ...BASELINE, attack: 500 });
    const pop = [...POP_BASE, attacker];
    expect(deriveDefaultProtectedStats(attacker, pop, 15)).toEqual({ attack: 0 });
  });

  it("[MOB-4] deriveBasicObjective merges move-speed floor for mobile roles", () => {
    const lucarioLike = makePokemon(
      "lucario-mob",
      { ...BASELINE, attack: 320 },
      { role: "AllRounder", attackType: "physical" },
    );
    const pop = [...POP_BASE, lucarioLike];
    const obj = deriveBasicObjective(lucarioLike, 15, [], pop);
    expect(obj.protectedFloors.moveSpeed).toBe(0);
    // Defining-stat protection is still present alongside the mobility guard.
    expect(obj.protectedFloors.attack).toBe(0);
  });

  it("[MOB-5] deriveBasicObjective omits move-speed floor for stationary roles", () => {
    const defender = makePokemon(
      "tank-mob",
      { ...BASELINE, hp: 12000, defense: 300 },
      { role: "Defender", attackType: "physical" },
    );
    const pop = [...POP_BASE, defender];
    const obj = deriveBasicObjective(defender, 15, [], pop);
    expect(obj.protectedFloors.moveSpeed).toBeUndefined();
  });

  it("[MOB-6] empty roster → no move-speed floor (backward-compatible)", () => {
    const poke = makePokemon("solo-mob", BASELINE, { role: "Speedster" });
    const obj = deriveBasicObjective(poke, 15, [], []);
    expect(obj.protectedFloors).toEqual({});
  });

  it("[MOB-7] move-speed floor penalises an emblem build that nets negative move speed", () => {
    const setBonuses: import("../../../types").EmblemSetBonus[] = [];
    // Emblem mimicking the +HP / −move-speed tax (Rhyhorn/Pupitar-style).
    const candidates = buildCandidatePool(
      [makeEmblem("rhyhorn-like", ["brown"], { hp: 50, moveSpeed: -35 })],
      {},
    );
    const opts = {
      mode: "maximize" as const,
      priorities: { hp: 4.5 },
      targets: {}, targetActive: {},
      protected: {},
      colorConstraints: null, colorBonuses: false,
      slots: 10,
    };
    const noGuard = evaluateLoadout(candidates, opts, setBonuses);
    const withGuard = evaluateLoadout(candidates, { ...opts, protected: { moveSpeed: 0 } }, setBonuses);
    expect(withGuard.score).toBeLessThan(noGuard.score);
  });
});

// ---------------------------------------------------------------------------
// Live roster: hybrid role rules on real UNITE-DB stats
// ---------------------------------------------------------------------------

describe("deriveDefaultProtectedStats — live roster cases", () => {
  const bundle = loadBundle(rawPatch);
  const pop = bundle.pokemon;

  function floorsFor(id: string) {
    const pokemon = pop.find((p) => p.id === id)!;
    return deriveDefaultProtectedStats(pokemon, pop, 15);
  }

  it("[PROT-14] Skeledirge: spAttack only, not hp", () => {
    const floors = floorsFor("skeledirge");
    expect(Object.keys(floors)).toEqual(["spAttack"]);
  });

  it("[PROT-15] Lucario: attack protected via offense fallback", () => {
    const floors = floorsFor("lucario");
    expect(Object.keys(floors)).toEqual(["attack"]);
  });

  it("[PROT-16] Snorlax: hp + defense (unchanged bulk tank)", () => {
    const floors = floorsFor("snorlax");
    expect(Object.keys(floors).sort()).toEqual(["defense", "hp"]);
  });

  it("[PROT-17] Pikachu: spAttack only, not hp", () => {
    const floors = floorsFor("pikachu");
    expect(Object.keys(floors)).toEqual(["spAttack"]);
  });

  it("[PROT-18] Charizard: attack protected (z > 0.4 primary pick)", () => {
    const floors = floorsFor("charizard");
    expect(Object.keys(floors)).toEqual(["attack"]);
  });

  it("[PROT-19] Lucario objective guards move speed (regression: HP-for-speed trade)", () => {
    const lucario = pop.find((p) => p.id === "lucario")!;
    const obj = deriveBasicObjective(lucario, 15, bundle.emblems, pop);
    expect(obj.protectedFloors.moveSpeed).toBe(0);
    expect(obj.protectedFloors.attack).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Protect penalty influences evaluateLoadout
// ---------------------------------------------------------------------------

describe("protect penalty influences evaluateLoadout", () => {
  const setBonuses: import("../../../types").EmblemSetBonus[] = [];

  it("[PROT-9] build with negative HP contribution penalised when HP protected", () => {
    // Candidate with −HP and some attack
    const candidates = buildCandidatePool(
      [makeEmblem("bad", ["pink"], { hp: -10, attack: 5 })],
      {},
    );

    // Without protect: score is just from attack weight
    const optsNoProtect = {
      mode: "maximize" as const,
      priorities: { attack: 1 },
      targets: {}, targetActive: {},
      protected: {},
      colorConstraints: null, colorBonuses: false,
      slots: 10,
    };
    const noProtect = evaluateLoadout(candidates, optsNoProtect, setBonuses);

    // With protect HP floor=0: penalty fires because hp contribution is −10 < 0
    const optsWithProtect = {
      ...optsNoProtect,
      protected: { hp: 0 },
    };
    const withProtect = evaluateLoadout(candidates, optsWithProtect, setBonuses);

    expect(withProtect.score).toBeLessThan(noProtect.score);
  });

  it("[PROT-10] build that does not violate floor has same score either way", () => {
    // Candidate with +HP (doesn't trigger floor=0)
    const candidates = buildCandidatePool(
      [makeEmblem("good", ["white"], { hp: 30, attack: 5 })],
      {},
    );
    const opts = {
      mode: "maximize" as const,
      priorities: { attack: 1 },
      targets: {}, targetActive: {},
      protected: {},
      colorConstraints: null, colorBonuses: false,
      slots: 10,
    };
    const noProtect = evaluateLoadout(candidates, opts, setBonuses);
    const withProtect = evaluateLoadout(candidates, { ...opts, protected: { hp: 0 } }, setBonuses);
    expect(withProtect.score).toBeCloseTo(noProtect.score);
  });
});

// ---------------------------------------------------------------------------
// deriveProtectFloors (combined z-score + mobility guard)
// ---------------------------------------------------------------------------

describe("deriveProtectFloors", () => {
  it("[PROT-14] merges defining-stat floors with mobility guard for mobile roles", () => {
    const lucarioLike = makePokemon(
      "lucario-protect",
      { ...BASELINE, attack: 320 },
      { role: "AllRounder", attackType: "physical" },
    );
    const pop = [...POP_BASE, lucarioLike];
    const floors = deriveProtectFloors(lucarioLike, pop, 15);
    expect(floors.attack).toBe(0);
    expect(floors.moveSpeed).toBe(0);
  });

  it("[PROT-15] empty roster → no floors (backward-compatible)", () => {
    const poke = makePokemon("solo-protect", BASELINE, { role: "Speedster" });
    expect(deriveProtectFloors(poke, [], 15)).toEqual({});
  });

  it("[PROT-16] matches deriveBasicObjective protectedFloors (Advanced parity contract)", () => {
    const attacker = makePokemon("att-protect", { ...BASELINE, attack: 500 }, { role: "Attacker" });
    const pop = [...POP_BASE, attacker];
    const obj = deriveBasicObjective(attacker, 15, [], pop);
    expect(deriveProtectFloors(attacker, pop, 15)).toEqual(obj.protectedFloors);
  });
});

// ---------------------------------------------------------------------------
// Integration: deriveBasicObjective + basicSearchOptions include protectedFloors
// ---------------------------------------------------------------------------

describe("deriveBasicObjective protectedFloors integration", () => {
  it("[PROT-11] passing allPokemon produces protectedFloors in objective", () => {
    const attacker = makePokemon("lucario", { ...BASELINE, attack: 500 });
    const pop = [...POP_BASE, attacker];
    // With population → should derive protect floors
    const obj = deriveBasicObjective(attacker, 15, [], pop);
    expect(Object.keys(obj.protectedFloors)).toContain("attack");
  });

  it("[PROT-12] empty allPokemon → empty protectedFloors (backward-compatible)", () => {
    const poke = makePokemon("lucario", BASELINE);
    const obj = deriveBasicObjective(poke, 15, [], []);
    expect(obj.protectedFloors).toEqual({});
  });

  it("[PROT-13] basicSearchOptions uses protectedFloors from objective", () => {
    const attacker = makePokemon("lucario", { ...BASELINE, attack: 500 });
    const pop = [...POP_BASE, attacker];
    const obj = deriveBasicObjective(attacker, 15, [], pop);
    const searchOpts = basicSearchOptions(obj);
    // The search opts.protected must match the derived floors
    expect(searchOpts.protected).toEqual(obj.protectedFloors);
    // And attack should be in there (high relative to population)
    expect(searchOpts.protected.attack).toBeDefined();
  });
});
