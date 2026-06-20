/**
 * Full mixed-grade exact enumeration — enumerateGradeVariants flag.
 */

import { describe, it, expect } from "vitest";
import { makeEmblem } from "../../__tests__/fixtures";
import { buildCandidatePool } from "../adapt";
import {
  buildColorTargetGroups,
  enumerateColorKVectors,
  computeKPrefix,
  computeGradeAwareKPrefix,
  searchColorExactSlice,
  searchColorExact,
} from "../exactColor";
import { countConstrainedBuilds, countExactEnumerationSpace, buildPool } from "../pool";
import { shouldRunExact, DEFAULT_EXACT_CAP } from "../orchestrator";
import type { EmblemCandidate, SearchOptions } from "../types";
import type { Emblem } from "../../../types";

function makeMultiGrade(name: string, colors: string[]): EmblemCandidate[] {
  const em = makeEmblem(name, colors as never, { attack: 1 });
  return buildCandidatePool([em], {
    ownedKeys: new Set(["gold", "silver"].map((g) => `${em.id}:${g}`)),
    mixedGrades: true,
  });
}

function minOpts(
  colorConstraints: Map<string, number>,
  enumerateGradeVariants: boolean,
): SearchOptions {
  return {
    mode: "maximize",
    priorities: { attack: 1 },
    targets: {},
    targetActive: {},
    protected: {},
    colorConstraints: colorConstraints as Map<never, number>,
    colorBonuses: false,
    slots: 10,
    enumerateGradeVariants,
  };
}

describe("countExactEnumerationSpace — gradeAware flag", () => {
  it("name-only and grade-aware counts diverge on mixed-grade pools", () => {
    const emblems: Emblem[] = Array.from({ length: 12 }, (_, i) =>
      makeEmblem(`Mon${i}`, ["brown"] as never, { attack: 1 }),
    );
    const ownedKeys = new Set<string>();
    for (const em of emblems) {
      for (const g of ["gold", "silver"]) ownedKeys.add(`${em.id}:${g}`);
    }
    const pool = buildCandidatePool(emblems, { ownedKeys, mixedGrades: true });
    const targets = new Map<string, number>([["brown", 10]]);

    const nameOnly = countExactEnumerationSpace(pool, targets as never, 10, false);
    const gradeAware = countExactEnumerationSpace(pool, targets as never, 10, true);

    expect(nameOnly).not.toBeNull();
    expect(gradeAware).not.toBeNull();
    expect(gradeAware! > nameOnly!).toBe(true);
  });

  it("single-grade pools: name-only equals grade-aware", () => {
    const pool = makeMultiGrade("A", ["brown"]).slice(0, 1);
    const targets = new Map<string, number>([["brown", 1]]);
    expect(countExactEnumerationSpace(pool, targets as never, 1, false)).toBe(
      countExactEnumerationSpace(pool, targets as never, 1, true),
    );
  });
});

describe("searchColorExact — grade enumeration", () => {
  it("enumerateGradeVariants finds a better loadout than bestVariantForMode fast path", async () => {
    // Two Pokémon, each with gold (+3 atk) and silver (+1 atk). Pick both.
    const emA = makeEmblem("Alpha", ["brown"] as never, {
      attack: 3,
      hp: 0,
    });
    const emB = makeEmblem("Beta", ["brown"] as never, {
      attack: 1,
      hp: 0,
    });
    // Override stats per grade via separate emblem entries isn't possible in one emblem —
    // use two emblems where gold has higher attack flat via buildCandidatePool grades.
    const pool = buildCandidatePool([emA, emB], {
      ownedKeys: new Set(["alpha:gold", "alpha:silver", "beta:gold", "beta:silver"]),
      mixedGrades: true,
    });

    const targets = new Map<string, number>([["brown", 2]]);
    const groups = buildColorTargetGroups(pool, targets as Map<never, number>);
    const sizes = groups.map((g) => g.names.length);
    const kVectors = enumerateColorKVectors(groups, sizes, [2], 2)!;
    const kPrefix = computeKPrefix(sizes, kVectors);

    // Dedupe variants map
    const variantsByName = new Map<string, EmblemCandidate[]>();
    for (const c of pool) {
      const list = variantsByName.get(c.pokemonName) ?? [];
      if (!list.some((x) => x.grade === c.grade)) list.push(c);
      variantsByName.set(c.pokemonName, list);
    }
    const gradePrefix2 = computeGradeAwareKPrefix(groups, sizes, kVectors, variantsByName);

    expect(kPrefix[kPrefix.length - 1]).toBe(1); // one name combo
    expect(gradePrefix2[gradePrefix2.length - 1]).toBe(4); // 2×2 grade assignments

    const fast = await searchColorExactSlice(
      pool,
      minOpts(targets, false),
      [],
      groups,
      kVectors,
      kPrefix,
      0,
      1,
    );
    const full = await searchColorExactSlice(
      pool,
      minOpts(targets, true),
      [],
      groups,
      kVectors,
      kPrefix,
      0,
      4,
    );

    expect(fast!.evaluated).toBe(1);
    expect(full!.evaluated).toBe(4);
    // Full enumeration should not score worse than fast path
    expect(full!.ev.score).toBeGreaterThanOrEqual(fast!.ev.score);
  }, 15_000);

  it("grade-aware enum space gates exact vs heuristic via exactCap", () => {
    const emblems: Emblem[] = Array.from({ length: 30 }, (_, i) =>
      makeEmblem(`Mon${i}`, ["brown"] as never, { attack: 1 }),
    );
    const ownedKeys = new Set<string>();
    for (let i = 0; i < 30; i++) {
      for (const g of ["gold", "silver", "bronze"]) ownedKeys.add(`mon${i}:${g}`);
    }
    const pool = buildCandidatePool(emblems, { ownedKeys, mixedGrades: true });
    const targets = new Map<string, number>([["brown", 10]]);

    const nameOnly = countExactEnumerationSpace(pool, targets as never, 10, false);
    const gradeAware = countConstrainedBuilds(pool, targets as never, 10);

    expect(shouldRunExact(nameOnly, DEFAULT_EXACT_CAP)).toBe(true);
    expect(shouldRunExact(gradeAware, DEFAULT_EXACT_CAP)).toBe(false);
  });
});

describe("full dataset — mixedGrades gates enumeration", () => {
  it("buildPool uses all allowed grades when mixedGrades on, best grade only when off", () => {
    const emblems = [makeEmblem("A", ["brown"] as never, { attack: 1 })];
    const allowedGrades = new Set(["gold", "silver"] as const);
    const poolOn = buildPool(
      emblems,
      { useOwned: false, mixedGrades: true, allowedGrades },
      new Set(),
    );
    const poolOff = buildPool(
      emblems,
      { useOwned: false, mixedGrades: false, allowedGrades },
      new Set(),
    );
    expect(poolOn.length).toBe(2);
    expect(poolOff.length).toBe(1);
    expect(poolOff[0]!.grade).toBe("gold");
  });

  it("enumerateGradeVariants=false uses name-only enum space on multi-grade full pool", () => {
    const emblems: Emblem[] = Array.from({ length: 12 }, (_, i) =>
      makeEmblem(`Mon${i}`, ["brown"] as never, { attack: 1 }),
    );
    const pool = buildCandidatePool(emblems, { grades: ["gold", "silver"] });
    const targets = new Map<string, number>([["brown", 10]]);

    const nameOnly = countExactEnumerationSpace(pool, targets as never, 10, false);
    const gradeAware = countExactEnumerationSpace(pool, targets as never, 10, true);

    expect(nameOnly).not.toBeNull();
    expect(gradeAware).not.toBeNull();
    expect(gradeAware! > nameOnly!).toBe(true);
  });
});

describe("searchColorExact integration — small mixed pool", () => {
  it("full grade enumeration evaluates grade-aware total", async () => {
    const emblems = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"].map((n) =>
      makeEmblem(n, ["brown"] as never, { attack: 1 }),
    );
    const ownedKeys = new Set(
      emblems.flatMap((e) => ["gold", "silver"].map((g) => `${e.id}:${g}`)),
    );
    const pool = buildCandidatePool(emblems, { ownedKeys, mixedGrades: true });
    const targets = new Map<string, number>([["brown", 10]]);
    const gradeAware = countExactEnumerationSpace(pool, targets as never, 10, true);
    expect(gradeAware).not.toBeNull();

    const result = await searchColorExact(pool, minOpts(targets, true), []);
    expect(result).not.toBeNull();
    expect(result!.evaluated).toBe(Number(gradeAware));
  }, 60_000);
});
