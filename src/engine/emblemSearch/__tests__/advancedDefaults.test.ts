/**
 * Tests for the Advanced-mode default derivation logic.
 *
 * Verifies that the colorTargetsFor → feasibility-check pipeline that powers
 * syncAdvancedFromBasic works correctly:
 *
 *  1. colorTargetsFor produces the expected meta targets for various roles/types.
 *  2. The feasibility check (countConstrainedBuilds > 0n) correctly identifies
 *     satisfiable vs. unsatisfiable targets given a pool.
 *  3. Infeasible targets (pool too sparse) are detected so the UI can fall back
 *     to weighted mode instead of blocking the user.
 */

import { describe, it, expect } from "vitest";
import { makeEmblem } from "../../__tests__/fixtures";
import { buildCandidatePool } from "../adapt";
import { countConstrainedBuilds } from "../pool";
import { colorGroupSizes } from "../exactColor";
import { colorTargetsFor } from "../../recommend";
import { deriveProtectFloors } from "../protectDefaults";
import { deriveBasicObjective } from "../basicObjective";
import { pokemonList } from "../../../data/gameData";
import type { EmblemColor } from "../../../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SLOTS = 10;

/**
 * Build a candidate pool from synthetic emblems.
 * Each call to makeEmblem produces a distinct Pokémon emblem.
 */
function buildSyntheticPool(specs: Array<{ name: string; colors: EmblemColor[] }>) {
  const emblems = specs.map((s) => makeEmblem(s.name, s.colors, { attack: 1 }));
  return buildCandidatePool(emblems, {});
}

/** Repeat a color assignment N times with distinct names. */
function nOf(n: number, colors: EmblemColor[], prefix = "p"): Array<{ name: string; colors: EmblemColor[] }> {
  return Array.from({ length: n }, (_, i) => ({ name: `${prefix}${i}`, colors }));
}

// ---------------------------------------------------------------------------
// colorTargetsFor — meta derivation
// ---------------------------------------------------------------------------

describe("colorTargetsFor — meta target derivation", () => {
  const byId = new Map(); // empty byId → falls back to archetype defaults

  it("[ADV-1] physical non-defender → brown=6, white=6", () => {
    const poke = { attackType: "physical", role: "Attacker", builds: [] } as never;
    const targets = colorTargetsFor(poke, byId);
    expect(targets.get("brown")).toBe(6);
    expect(targets.get("white")).toBe(6);
    expect(targets.size).toBe(2);
  });

  it("[ADV-2] special non-defender → green=6, black=6", () => {
    const poke = { attackType: "special", role: "Attacker", builds: [] } as never;
    const targets = colorTargetsFor(poke, byId);
    expect(targets.get("green")).toBe(6);
    expect(targets.get("black")).toBe(6);
  });

  it("[ADV-3] Supporter → black=6, white=4", () => {
    const poke = { attackType: "physical", role: "Supporter", builds: [] } as never;
    const targets = colorTargetsFor(poke, byId);
    expect(targets.get("black")).toBe(6);
    expect(targets.get("white")).toBe(4);
  });

  it("[ADV-4] physical Defender → white=6, brown=4, blue=2", () => {
    const poke = { attackType: "physical", role: "Defender", builds: [] } as never;
    const targets = colorTargetsFor(poke, byId);
    expect(targets.get("white")).toBe(6);
    expect(targets.get("brown")).toBe(4);
    expect(targets.get("blue")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Feasibility check — pool can satisfy targets
// ---------------------------------------------------------------------------

describe("feasibility check — Advanced defaults gating", () => {
  it("[ADV-5] full pool with brown+white emblems → feasible (exact mode allowed)", () => {
    // Targets: brown=6, white=6 (sum=12 ≤ 20). Achievable with dual-color emblems
    // (brown+white) that each contribute 1 to both counts in a 10-slot build.
    // Use 8 dual-color + 6 single-color fill → pick e.g. 6 dual + 2 brown + 2 white = 10.
    const specs = [
      ...nOf(8, ["brown", "white"], "bw"),   // dual-color
      ...nOf(4, ["brown"], "br"),             // single brown
      ...nOf(4, ["white"], "wh"),             // single white
      ...nOf(4, ["green"], "gr"),             // fill
    ];
    const pool = buildSyntheticPool(specs);
    const targets = new Map<EmblemColor, number>([["brown", 6], ["white", 6]]);

    // Capacity check
    const caps = colorGroupSizes(pool);
    expect(caps.get("brown")).toBeGreaterThanOrEqual(6);
    expect(caps.get("white")).toBeGreaterThanOrEqual(6);

    const count = countConstrainedBuilds(pool, targets, SLOTS);
    expect(count).not.toBeNull();
    expect(count! > 0n).toBe(true); // feasible → exact mode
  });

  it("[ADV-6] pool with too few brown emblems → infeasible (weighted fallback)", () => {
    // Only 3 brown available; target is 6 → impossible
    const specs = [
      ...nOf(3, ["brown"], "br"),
      ...nOf(7, ["white"], "wh"),
    ];
    const pool = buildSyntheticPool(specs);
    const targets = new Map<EmblemColor, number>([["brown", 6], ["white", 6]]);

    const caps = colorGroupSizes(pool);
    const capacityOk = [...targets.entries()].every(([c, n]) => n <= (caps.get(c) ?? 0));
    expect(capacityOk).toBe(false); // capacity check fails → infeasible
  });

  it("[ADV-7] target sum > 20 → countConstrainedBuilds returns 0n (infeasible)", () => {
    // brown=11 + white=11 = sum 22 > 2*SLOTS(20) → impossible even with dual-color.
    const specs = [
      ...nOf(15, ["brown"], "br"),
      ...nOf(15, ["white"], "wh"),
    ];
    const pool = buildSyntheticPool(specs);
    const targets = new Map<EmblemColor, number>([["brown", 11], ["white", 11]]);
    const sum = [...targets.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(2 * SLOTS);
    // countConstrainedBuilds internally catches sum > 2*slots → 0n
    const count = countConstrainedBuilds(pool, targets, SLOTS);
    expect(count).toBe(0n);
  });

  it("[ADV-8] countConstrainedBuilds returns 0n when no pool can hit the target", () => {
    // 0 brown emblems; target is 4 brown → 0 builds
    const specs = nOf(15, ["white"], "wh");
    const pool = buildSyntheticPool(specs);
    const targets = new Map<EmblemColor, number>([["brown", 4]]);
    const count = countConstrainedBuilds(pool, targets, SLOTS);
    expect(count).toBe(0n);
  });

  it("[ADV-9] dual-color emblems satisfy two targets at once → feasible", () => {
    // 7 brown+white dual-color emblems: each provides 1 point to both colors.
    // A 10-pick build from them yields brown=10, white=10 — but targets of 6+6=12 ≤ 20.
    const specs = [
      ...nOf(10, ["brown", "white"], "bw"),
      ...nOf(5, ["green"], "gr"), // padding so we can pick exactly 10
    ];
    const pool = buildSyntheticPool(specs);
    const targets = new Map<EmblemColor, number>([["brown", 6], ["white", 6]]);
    const count = countConstrainedBuilds(pool, targets, SLOTS);
    expect(count).not.toBeNull();
    expect(count! > 0n).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Protect floors — Advanced UI must match Basic objective defaults
// ---------------------------------------------------------------------------

describe("Advanced protect defaults parity", () => {
  it("[ADV-10] deriveProtectFloors matches deriveBasicObjective for mobile roles", () => {
    const speedster = pokemonList.find((p) => p.role === "Speedster");
    if (!speedster) return;

    const obj = deriveBasicObjective(speedster, 15, [], pokemonList);
    const floors = deriveProtectFloors(speedster, pokemonList, 15);
    expect(floors).toEqual(obj.protectedFloors);
    expect(floors.moveSpeed).toBe(0);
  });

  it("[ADV-11] Dragapult gets moveSpeed protect floor (Attacker mobility guard)", () => {
    const dragapult = pokemonList.find((p) => p.id === "dragapult");
    if (!dragapult) return;

    const floors = deriveProtectFloors(dragapult, pokemonList, 15);
    expect(dragapult.role).toBe("Attacker");
    expect(floors.moveSpeed).toBe(0);

    const obj = deriveBasicObjective(dragapult, 15, [], pokemonList);
    expect(floors).toEqual(obj.protectedFloors);
  });
});
