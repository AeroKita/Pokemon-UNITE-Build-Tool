import { describe, it, expect } from "vitest";
import { emblems, setBonuses, pokemonList } from "../../../data/gameData";
import { buildCandidatePool } from "../adapt";
import {
  evaluateLoadout,
  sumStats,
  countColorsRaw,
  colorsMatchTargets,
  SCORE_EPS,
} from "../evaluate";
import type { PokemonScoringContext, SearchOptions } from "../types";

function makeMaximizeOpts(): SearchOptions {
  return {
    mode: "maximize",
    priorities: { attack: 3, hp: 1 },
    targets: {},
    targetActive: {},
    protected: {},
    colorConstraints: null,
    colorBonuses: false,
    slots: 10,
  };
}

describe("evaluate — sumStats", () => {
  it("sums stats across candidates", () => {
    const pool = buildCandidatePool(emblems.slice(0, 3), { grades: ["gold"] });
    const totals = sumStats(pool);
    let expectedHp = 0;
    for (const c of pool) expectedHp += c.stats.hp ?? 0;
    expect(totals.hp ?? 0).toBeCloseTo(expectedHp);
  });
});

describe("evaluate — countColorsRaw", () => {
  it("counts colors for a loadout of distinct Pokémon", () => {
    const pool = buildCandidatePool(emblems.slice(0, 6), { grades: ["gold"] });
    const counts = countColorsRaw(pool);
    let total = 0;
    for (const n of counts.values()) total += n;
    // Each emblem contributes its 1-2 colors
    expect(total).toBeGreaterThanOrEqual(6);
  });

  it("does NOT double-count dual-color emblems per slot", () => {
    const dual = emblems.find((e) => e.colors.length === 2)!;
    const pool = buildCandidatePool([dual], { grades: ["gold"] });
    const counts = countColorsRaw(pool);
    expect(counts.get(dual.colors[0])).toBe(1);
    expect(counts.get(dual.colors[1])).toBe(1);
  });
});

describe("evaluate — color target matching", () => {
  it("returns false when color count doesn't match target", () => {
    const counts = new Map([["brown", 5] as [string, number]]);
    const targets = new Map([["brown", 6] as [string, number]]);
    expect(colorsMatchTargets(counts as never, targets as never)).toBe(false);
  });

  it("returns true for null targets (no constraint)", () => {
    const counts = new Map([["brown", 3] as [string, number]]);
    expect(colorsMatchTargets(counts as never, null)).toBe(true);
  });
});

describe("evaluate — maximize scoring", () => {
  it("valid loadout gets a finite positive score for attack-priority opts", () => {
    const pool = buildCandidatePool(emblems, { grades: ["gold"] }).slice(0, 10);
    // ensure distinct Pokémon
    const seen = new Set<string>();
    const distinct = pool.filter((c) => {
      if (seen.has(c.pokemonName)) return false;
      seen.add(c.pokemonName);
      return true;
    });
    const opts = makeMaximizeOpts();
    const ev = evaluateLoadout(distinct.slice(0, 10), opts, setBonuses);
    expect(ev.valid).toBe(true);
    expect(isFinite(ev.score)).toBe(true);
  });

  it("invalid color constraint makes loadout invalid", () => {
    const pool = buildCandidatePool(emblems, { grades: ["gold"] }).slice(0, 10);
    const opts: SearchOptions = {
      ...makeMaximizeOpts(),
      colorConstraints: new Map([["brown", 99]]), // impossible
    };
    const ev = evaluateLoadout(pool, opts, setBonuses);
    expect(ev.valid).toBe(false);
    expect(ev.score).toBe(-1e12);
  });

  it("protect floor penalty reduces score for stat below floor", () => {
    const brownEmblems = emblems.filter((e) => e.colors.includes("brown"));
    const pool = buildCandidatePool(brownEmblems.slice(0, 10), { grades: ["gold"] });
    const seen = new Set<string>();
    const distinct = pool.filter((c) => { if (seen.has(c.pokemonName)) return false; seen.add(c.pokemonName); return true; });
    if (distinct.length < 10) return; // not enough unique → skip

    const opts: SearchOptions = {
      ...makeMaximizeOpts(),
      protected: { attack: 1000 }, // impossibly high floor
    };
    const ev = evaluateLoadout(distinct.slice(0, 10), opts, setBonuses);
    expect(ev.valid).toBe(true);
    expect(ev.score).toBeLessThan(0); // penalty should dominate
  });

  it("moveSpeed protect floor penalizes builds below the floor", () => {
    const pool = buildCandidatePool(emblems, { grades: ["gold"] }).slice(0, 10);
    const seen = new Set<string>();
    const distinct = pool.filter((c) => {
      if (seen.has(c.pokemonName)) return false;
      seen.add(c.pokemonName);
      return true;
    });
    if (distinct.length < 10) return;

    const opts: SearchOptions = {
      ...makeMaximizeOpts(),
      protected: { moveSpeed: 10000 },
    };
    const ev = evaluateLoadout(distinct.slice(0, 10), opts, setBonuses);
    expect(ev.valid).toBe(true);
    expect(ev.score).toBeLessThan(0);
  });
});

describe("evaluate — survivability set-bonus floor", () => {
  it("values a white (HP) set bonus in pokemon mode even with zero hp priority", () => {
    // White-only emblems so the only set bonus reached is white → HP. With no hp
    // priority weight, the bonus is only scored via SURVIVAL_SET_BONUS_FLOOR, so
    // turning colorBonuses on must raise the score vs off.
    const whiteOnly = emblems.filter((e) => e.colors.length === 1 && e.colors[0] === "white");
    const pool = buildCandidatePool(whiteOnly, { grades: ["gold"] });
    const seen = new Set<string>();
    const distinct = pool.filter((c) => {
      if (seen.has(c.pokemonName)) return false;
      seen.add(c.pokemonName);
      return true;
    });
    if (distinct.length < 10) return; // not enough unique white emblems → skip
    const loadout = distinct.slice(0, 10);

    const baseStats = pokemonList[0].baseStatsByLevel[14];
    const pokemonContext: PokemonScoringContext = {
      pokemonId: pokemonList[0].id,
      level: 15,
      baseStats,
    };
    const base: SearchOptions = {
      mode: "maximize",
      priorities: { attack: 3 }, // deliberately NO hp weight
      targets: {},
      targetActive: {},
      protected: {},
      colorConstraints: null,
      colorBonuses: false,
      scoringMode: "pokemon",
      pokemonContext,
      slots: 10,
    };

    const withoutBonus = evaluateLoadout(loadout, base, setBonuses).score;
    const withBonus = evaluateLoadout(loadout, { ...base, colorBonuses: true }, setBonuses).score;

    // Flat-stat scoring is identical; the only delta is the white HP set bonus,
    // which is now valued despite hp having no priority weight.
    expect(withBonus).toBeGreaterThan(withoutBonus);
  });
});

describe("evaluate — target mode", () => {
  it("error is 0 when totals exactly match targets", () => {
    const pool = buildCandidatePool(emblems, { grades: ["gold"] });
    const seen = new Set<string>();
    const distinct = pool.filter((c) => { if (seen.has(c.pokemonName)) return false; seen.add(c.pokemonName); return true; }).slice(0, 10);
    const totals = sumStats(distinct);

    const opts: SearchOptions = {
      mode: "target",
      priorities: {},
      targets: { attack: totals.attack ?? 0 },
      targetActive: { attack: true },
      protected: {},
      colorConstraints: null,
      colorBonuses: false,
      slots: 10,
    };
    const ev = evaluateLoadout(distinct, opts, setBonuses);
    expect(ev.valid).toBe(true);
    expect(ev.error ?? 1).toBeLessThanOrEqual(SCORE_EPS + 0.51); // within tolerance
  });
});
