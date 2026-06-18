/**
 * Tests for the shared preset resolver that powers Beginner's Expert-equivalent
 * search.
 *
 * Invariants:
 *  1. resolveColorSearchMode → "weighted" (null constraints) when the targets
 *     can't be enforced on the pool (sparse owned pool, insufficient capacity).
 *  2. resolveColorSearchMode → "exact" (non-null constraints) when the targets
 *     are feasible on a rich pool (full dataset + an attacker meta).
 *  3. resolveColorSearchMode → "weighted" when the constrained count is 0n.
 *  4. buildPresetSearchOptions emits the Expert-equivalent SearchOptions:
 *     maximize mode, pokemon scoring, exactCap=DEFAULT_EXACT_CAP, hard
 *     constraints when feasible.
 *  5. Integration: buildPresetSearchOptions → runSearch produces an exact
 *     result on feasible meta targets.
 */

import { describe, it, expect } from "vitest";
import { makeEmblem } from "../../__tests__/fixtures";
import { buildCandidatePool } from "../adapt";
import { resolveColorSearchMode, buildPresetSearchOptions } from "../searchPresets";
import { DEFAULT_EXACT_CAP, runSearch } from "../orchestrator";
import type { Emblem, EmblemColor, Pokemon } from "../../../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SLOTS = 10;

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

function nOf(
  n: number,
  colors: EmblemColor[],
  prefix: string,
  stats: Partial<ReturnType<typeof makeStats>> = { attack: 1 },
): Emblem[] {
  return Array.from({ length: n }, (_, i) => makeEmblem(`${prefix}${i}`, colors, stats));
}

// ---------------------------------------------------------------------------
// resolveColorSearchMode
// ---------------------------------------------------------------------------

describe("resolveColorSearchMode", () => {
  const physicalTargets = new Map<EmblemColor, number>([["brown", 6], ["white", 6]]);

  it("[PRE-1] sparse owned pool → weighted (null constraints)", () => {
    // Only 3 brown + 5 white owned — can't reach brown=6.
    const emblems = [...nOf(3, ["brown"], "br"), ...nOf(5, ["white"], "wh")];
    const pool = buildCandidatePool(emblems, {});

    const res = resolveColorSearchMode(pool, physicalTargets, SLOTS);

    expect(res.mode).toBe("weighted");
    expect(res.colorConstraints).toBeNull();
    expect(res.willRunExact).toBe(false);
  });

  it("[PRE-2] rich full pool + attacker meta → exact (non-null constraints)", () => {
    // Plenty of brown / white capacity → brown=6, white=6 enforceable.
    const emblems = [
      ...nOf(8, ["brown", "white"], "bw"),
      ...nOf(4, ["brown"], "br"),
      ...nOf(4, ["white"], "wh"),
      ...nOf(4, ["green"], "gr"),
    ];
    const pool = buildCandidatePool(emblems, {});

    const res = resolveColorSearchMode(pool, physicalTargets, SLOTS);

    expect(res.mode).toBe("exact");
    expect(res.colorConstraints).not.toBeNull();
    expect(res.colorConstraints!.get("brown")).toBe(6);
    expect(res.colorConstraints!.get("white")).toBe(6);
    expect(res.constrainedBuildCount).not.toBeNull();
    expect(res.constrainedBuildCount! > 0n).toBe(true);
    expect(res.willRunExact).toBe(true);
  });

  it("[PRE-3] capacity present but count 0n → weighted", () => {
    // brown=6,white=6 with only single-color emblems and exactly 6 of each,
    // plus no extra fill: a 10-pick build can't hit brown=6 AND white=6
    // simultaneously (6+6=12 picks needed, only 10 slots, no dual-color).
    const emblems = [...nOf(6, ["brown"], "br"), ...nOf(6, ["white"], "wh")];
    const pool = buildCandidatePool(emblems, {});

    const res = resolveColorSearchMode(pool, physicalTargets, SLOTS);

    expect(res.mode).toBe("weighted");
    expect(res.colorConstraints).toBeNull();
    expect(res.constrainedBuildCount).toBe(0n);
    expect(res.willRunExact).toBe(false);
  });

  it("[PRE-4] empty targets → weighted", () => {
    const emblems = nOf(15, ["brown"], "br");
    const pool = buildCandidatePool(emblems, {});
    const res = resolveColorSearchMode(pool, new Map(), SLOTS);
    expect(res.mode).toBe("weighted");
    expect(res.colorConstraints).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildPresetSearchOptions
// ---------------------------------------------------------------------------

describe("buildPresetSearchOptions", () => {
  // Physical attacker → colorTargetsFor returns brown=6, white=6.
  const pokemon = makePokemon("lucario", "physical", "Attacker");
  const feasibleEmblems = [
    ...nOf(8, ["brown", "white"], "bw"),
    ...nOf(4, ["brown"], "br"),
    ...nOf(4, ["white"], "wh"),
    ...nOf(4, ["green"], "gr"),
  ];

  it("[PRE-5] feasible pool → Expert-equivalent options with hard constraints", () => {
    const pool = buildCandidatePool(feasibleEmblems, {});
    const { options, resolution } = buildPresetSearchOptions({
      pokemon,
      level: 15,
      pool,
      emblems: feasibleEmblems,
      pokemonList: [],
    });

    expect(options.mode).toBe("maximize");
    expect(options.scoringMode).toBe("pokemon");
    expect(options.pokemonContext).toBeDefined();
    expect(options.colorBonuses).toBe(true);
    expect(options.slots).toBe(SLOTS);
    expect(options.exactCap).toBe(DEFAULT_EXACT_CAP);
    expect(resolution.mode).toBe("exact");
    expect(options.colorConstraints).not.toBeNull();
    expect(options.colorConstraints!.get("brown")).toBe(6);
    expect(options.colorConstraints!.get("white")).toBe(6);
  });

  it("[PRE-6] sparse pool → options with null constraints (heuristic)", () => {
    const sparse = [...nOf(3, ["brown"], "br"), ...nOf(9, ["white"], "wh")];
    const pool = buildCandidatePool(sparse, {});
    const { options, resolution } = buildPresetSearchOptions({
      pokemon,
      level: 15,
      pool,
      emblems: sparse,
      pokemonList: [],
    });

    expect(resolution.mode).toBe("weighted");
    expect(options.colorConstraints).toBeNull();
  });

  it("[PRE-8] forceHeuristic strips hard constraints even when exact is feasible", () => {
    // Same feasible pool as PRE-5, but the user picked a time-based effort →
    // forceHeuristic. The resolution still reports exact-feasible, but the
    // emitted options carry NO hard color constraints so the orchestrator runs
    // the heuristic. colorBonuses stays on for soft steering toward meta colors.
    const pool = buildCandidatePool(feasibleEmblems, {});
    const { options, resolution } = buildPresetSearchOptions({
      pokemon,
      level: 15,
      pool,
      emblems: feasibleEmblems,
      pokemonList: [],
      forceHeuristic: true,
    });

    // Feasibility unchanged — the option to run exact still exists.
    expect(resolution.mode).toBe("exact");
    expect(resolution.willRunExact).toBe(true);
    // ...but options deliberately skip exact.
    expect(options.colorConstraints).toBeNull();
    expect(options.colorBonuses).toBe(true);
  });

  it("[PRE-9] forceHeuristic=false (default) keeps hard constraints when feasible", () => {
    const pool = buildCandidatePool(feasibleEmblems, {});
    const { options } = buildPresetSearchOptions({
      pokemon,
      level: 15,
      pool,
      emblems: feasibleEmblems,
      pokemonList: [],
      forceHeuristic: false,
    });

    expect(options.colorConstraints).not.toBeNull();
    expect(options.colorConstraints!.get("brown")).toBe(6);
    expect(options.colorConstraints!.get("white")).toBe(6);
  });

  it("[PRE-10] forceHeuristic on an infeasible pool stays null (heuristic, as today)", () => {
    const sparse = [...nOf(3, ["brown"], "br"), ...nOf(9, ["white"], "wh")];
    const pool = buildCandidatePool(sparse, {});
    const { options, resolution } = buildPresetSearchOptions({
      pokemon,
      level: 15,
      pool,
      emblems: sparse,
      pokemonList: [],
      forceHeuristic: true,
    });

    expect(resolution.willRunExact).toBe(false);
    expect(options.colorConstraints).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration: preset builder → runSearch → exact result
// ---------------------------------------------------------------------------

describe("preset → runSearch integration", () => {
  it("[PRE-7] feasible meta targets run an exact search", async () => {
    const pokemon = makePokemon("lucario", "physical", "Attacker");
    // 6 dual brown+white + 4 green fill = brown6, white6 in a 10-pick build.
    const emblems = [
      ...nOf(8, ["brown", "white"], "bw"),
      ...nOf(6, ["green"], "gr"),
    ];
    const pool = buildCandidatePool(emblems, {});
    const { options, resolution } = buildPresetSearchOptions({
      pokemon,
      level: 15,
      pool,
      emblems,
      pokemonList: [],
    });

    expect(resolution.willRunExact).toBe(true);

    const result = await runSearch({ pool, options, setBonuses: [], effort: "quick" });

    expect(result).not.toBeNull();
    expect(result!.exact).toBe(true);
    expect(result!.phase).toBe("exact");
    expect(result!.picks).toHaveLength(SLOTS);
  });

  it("[PRE-11] forceHeuristic skips exact and runs the heuristic path", async () => {
    const pokemon = makePokemon("lucario", "physical", "Attacker");
    const emblems = [
      ...nOf(8, ["brown", "white"], "bw"),
      ...nOf(6, ["green"], "gr"),
    ];
    const pool = buildCandidatePool(emblems, {});
    const { options, resolution } = buildPresetSearchOptions({
      pokemon,
      level: 15,
      pool,
      emblems,
      pokemonList: [],
      forceHeuristic: true,
    });

    // Exact is feasible, but we deliberately skipped it.
    expect(resolution.willRunExact).toBe(true);
    expect(options.colorConstraints).toBeNull();

    const result = await runSearch({ pool, options, setBonuses: [], effort: "quick" });

    expect(result).not.toBeNull();
    expect(result!.exact).toBe(false);
    expect(result!.phase).toBe("heuristic");
    expect(result!.picks).toHaveLength(SLOTS);
  });
});
