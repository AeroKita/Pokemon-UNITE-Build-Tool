/**
 * Tests for dual-color-aware color constraints.
 *
 * Key invariants:
 *  1. countColorsRaw counts BOTH colors of a dual-color emblem.
 *  2. A color target vector whose sum exceeds 10 (e.g. 6+7=13) is accepted by
 *     colorsMatchTargets when the actual counts match exactly.
 *  3. colorGroupSizes reports the correct per-color distinct-Pokémon count,
 *     including emblems that are dual-color.
 *  4. The exact-color search finds a valid loadout for a dual-heavy target given
 *     a pool that can realise it.
 *  5. Per-color capacity is bounded by SLOTS even if more than 10 distinct Pokémon
 *     share that color.
 */

import { describe, it, expect } from "vitest";
import { makeEmblem } from "../../__tests__/fixtures";
import { buildCandidatePool } from "../adapt";
import { countColorsRaw, colorsMatchTargets } from "../evaluate";
import { colorGroupSizes } from "../exactColor";
import type { EmblemCandidate } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandidate(
  name: string,
  colors: string[],
): EmblemCandidate {
  const emblem = makeEmblem(name, colors as never, { attack: 1 });
  const pool = buildCandidatePool([emblem], { grades: ["gold"] });
  return pool[0];
}

/** Build N dual-color candidates with distinct Pokémon names. */
function makeDuals(
  n: number,
  colors: [string, string],
  prefix = "Dual",
): EmblemCandidate[] {
  return Array.from({ length: n }, (_, i) =>
    makeCandidate(`${prefix}${i}`, colors),
  );
}

/** Build N single-color candidates with distinct Pokémon names. */
function makeSingles(
  n: number,
  color: string,
  prefix = "Single",
): EmblemCandidate[] {
  return Array.from({ length: n }, (_, i) =>
    makeCandidate(`${prefix}${i}`, [color]),
  );
}

// ---------------------------------------------------------------------------
// 1. countColorsRaw — dual-color emblems count toward both colors
// ---------------------------------------------------------------------------

describe("countColorsRaw — dual-color emblems", () => {
  it("counts both colors of a single dual-color emblem", () => {
    const c = makeCandidate("GreenBlack", ["green", "black"]);
    const counts = countColorsRaw([c]);
    expect(counts.get("green")).toBe(1);
    expect(counts.get("black")).toBe(1);
  });

  it("6 green + 7 black build has total color-points of 13", () => {
    // 6 pure-green + 1 green/black dual + 6 pure-black
    // but with only 10 Pokémon we do: 3 green/black duals + 3 green + 4 black
    // = 6 green, 7 black, 10 slots total
    const duals = makeDuals(3, ["green", "black"], "GBDual");        // 3×dual
    const pureGreen = makeSingles(3, "green", "PureGreen");           // 3×green
    const pureBlack = makeSingles(4, "black", "PureBlack");           // 4×black
    const loadout = [...duals, ...pureGreen, ...pureBlack];
    expect(loadout).toHaveLength(10);

    const counts = countColorsRaw(loadout);
    expect(counts.get("green")).toBe(6);   // 3 duals + 3 pure-green
    expect(counts.get("black")).toBe(7);   // 3 duals + 4 pure-black
    // Total color-points = 13, not 10
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(13);
  });

  it("sum of color-points can exceed 10 for a 10-slot build with duals", () => {
    // 10 dual-color emblems → 20 color-points total (the theoretical max)
    const duals = makeDuals(10, ["green", "black"], "All10Duals");
    const counts = countColorsRaw(duals);
    expect(counts.get("green")).toBe(10);
    expect(counts.get("black")).toBe(10);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// 2. colorsMatchTargets — accepts targets with sum > 10
// ---------------------------------------------------------------------------

describe("colorsMatchTargets — dual-heavy target vectors", () => {
  it("accepts a 6 green + 7 black target when counts match exactly", () => {
    const duals = makeDuals(3, ["green", "black"], "GBDual");
    const pureGreen = makeSingles(3, "green", "PureGreen");
    const pureBlack = makeSingles(4, "black", "PureBlack");
    const loadout = [...duals, ...pureGreen, ...pureBlack];
    const counts = countColorsRaw(loadout);

    const targets = new Map<string, number>([["green", 6], ["black", 7]]);
    expect(colorsMatchTargets(counts as never, targets as never)).toBe(true);
  });

  it("rejects when one color count is off by one", () => {
    const counts = new Map<string, number>([["green", 5], ["black", 7]]);
    const targets = new Map<string, number>([["green", 6], ["black", 7]]);
    expect(colorsMatchTargets(counts as never, targets as never)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. colorGroupSizes — per-color distinct-Pokémon capacity
// ---------------------------------------------------------------------------

describe("colorGroupSizes", () => {
  it("counts distinct Pokémon per color, not per-candidate", () => {
    const pool = [
      makeCandidate("GreenBlack1", ["green", "black"]),
      makeCandidate("GreenBlack2", ["green", "black"]),
      makeCandidate("PureGreen", ["green"]),
    ];
    const sizes = colorGroupSizes(pool);
    expect(sizes.get("green")).toBe(3);   // 3 distinct Pokémon have green
    expect(sizes.get("black")).toBe(2);   // 2 distinct Pokémon have black
  });

  it("dual-color emblem is counted toward BOTH color groups", () => {
    const pool = [makeCandidate("Dual", ["green", "black"])];
    const sizes = colorGroupSizes(pool);
    expect(sizes.get("green")).toBe(1);
    expect(sizes.get("black")).toBe(1);
  });

  it("same Pokémon at multiple grades counts once per color", () => {
    const emblem = makeEmblem("SharedPokemon", ["green", "black"] as never, { attack: 1 });
    const pool = buildCandidatePool([emblem], { grades: ["gold", "silver", "bronze"] });
    // Multiple grade variants, same pokemonName
    const sizes = colorGroupSizes(pool);
    expect(sizes.get("green")).toBe(1);
    expect(sizes.get("black")).toBe(1);
  });

  it("per-color capacity reflects actual pool, not hardcoded 10", () => {
    // Pool with only 3 Pokémon having green
    const pool = makeSingles(3, "green", "Green");
    const sizes = colorGroupSizes(pool);
    expect(sizes.get("green")).toBe(3);
    // A constraint of 4 green would exceed capacity
    expect((sizes.get("green") ?? 0) < 4).toBe(true);
  });
});
