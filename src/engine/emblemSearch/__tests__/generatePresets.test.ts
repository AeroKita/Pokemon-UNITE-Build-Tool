/**
 * Unit tests for the emblem-optimizer preset generator's pure derivation
 * helpers (tools/meta-defaults/generate-presets.ts).
 *
 * Covers: statistics helpers, build totals, priority derivation (flat + set-bonus
 * intent), protect-floor derivation (p10 clamp + mobility), vote-weighted color
 * aggregation, robust confidence, and the end-to-end per-Pokémon generation
 * (including the fallback conditions).
 */

import { describe, it, expect } from "vitest";
import { loadBundle } from "../../../data/loadBundle";
import rawPatch from "../../../data/patch-current.json";
import {
  bonusPctFor,
  buildDistances,
  buildStatTotals,
  computeConfidence,
  deriveColorTargets,
  derivePriorities,
  deriveProtectedFloors,
  generatePresetForPokemon,
  isUsableBuild,
  median,
  percentile,
  round2,
  snapColorTargetDownOneTier,
  snapColorTargetUp,
  colorTargetSnapUpOrder,
  leastDominantColorTarget,
} from "../../../../tools/meta-defaults/generate-presets";
import { makeEmblem } from "../../__tests__/fixtures";
import type { Emblem, EmblemSetBonus, Pokemon, PokemonBuild, StatBlock } from "../../../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function statBlock(overrides: Partial<StatBlock> = {}): StatBlock {
  return {
    hp: 0,
    attack: 0,
    defense: 0,
    spAttack: 0,
    spDefense: 0,
    critRate: 0,
    cdr: 0,
    lifesteal: 0,
    spLifesteal: 0,
    attackSpeed: 0,
    moveSpeed: 0,
    ...overrides,
  };
}

const GREEN_SB: EmblemSetBonus = {
  color: "green",
  stat: "spAttack",
  thresholds: { 2: 0.01, 4: 0.02, 6: 0.04 },
};
const WHITE_SB: EmblemSetBonus = {
  color: "white",
  stat: "hp",
  thresholds: { 2: 0.01, 4: 0.02, 6: 0.04 },
};
const BROWN_SB: EmblemSetBonus = {
  color: "brown",
  stat: "attack",
  thresholds: { 2: 0.01, 4: 0.02, 6: 0.04 },
};
const BLACK_SB: EmblemSetBonus = {
  color: "black",
  stat: "cdr",
  thresholds: { 3: 0.01, 5: 0.02, 7: 0.04 },
};
const SET_BONUSES = [GREEN_SB, WHITE_SB, BROWN_SB];

/** Build an emblem map + a 10-emblem build from a color list. */
function buildFromColors(colors: ("green" | "white" | "brown")[]): {
  build: PokemonBuild;
  byId: Map<string, Emblem>;
} {
  const emblems = colors.map((c, i) => makeEmblem(`${c}${i}`, [c], { attack: 1 }));
  const byId = new Map(emblems.map((e) => [e.id, e]));
  const build: PokemonBuild = {
    name: "b",
    heldItemIds: [],
    emblems: emblems.map((e) => ({ emblemId: e.id, grade: "gold" as const })),
  };
  return { build, byId };
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

describe("statistics helpers", () => {
  it("[GEN-1] median handles even/odd/empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
    expect(median([7])).toBe(7);
  });

  it("[GEN-2] percentile interpolates and handles edges", () => {
    expect(percentile([], 10)).toBe(0);
    expect(percentile([5], 10)).toBe(5);
    expect(percentile([0, 100], 10)).toBeCloseTo(10);
    expect(percentile([10, 20, 30], 50)).toBeCloseTo(20);
  });

  it("[GEN-3] round2 rounds to 2 decimals", () => {
    expect(round2(0.126)).toBe(0.13);
    expect(round2(1)).toBe(1);
  });

  it("[GEN-4] bonusPctFor picks the highest reached threshold", () => {
    expect(bonusPctFor(GREEN_SB, 1)).toBe(0); // below 2
    expect(bonusPctFor(GREEN_SB, 3)).toBe(0.01); // reaches 2
    expect(bonusPctFor(GREEN_SB, 5)).toBe(0.02); // reaches 4
    expect(bonusPctFor(GREEN_SB, 6)).toBe(0.04);
  });
});

// ---------------------------------------------------------------------------
// Build totals
// ---------------------------------------------------------------------------

describe("build totals + usability", () => {
  it("[GEN-5] isUsableBuild requires 10 resolvable emblems", () => {
    const { build, byId } = buildFromColors(Array(10).fill("green"));
    expect(isUsableBuild(build, byId)).toBe(true);

    const short = { ...build, emblems: build.emblems.slice(0, 9) };
    expect(isUsableBuild(short, byId)).toBe(false);

    const missing = {
      ...build,
      emblems: [...build.emblems.slice(0, 9), { emblemId: "nope", grade: "gold" as const }],
    };
    expect(isUsableBuild(missing, byId)).toBe(false);
  });

  it("[GEN-6] buildStatTotals sums flat emblem stats", () => {
    const e1 = makeEmblem("a", ["green"], { spAttack: 3, hp: -50 });
    const e2 = makeEmblem("b", ["white"], { hp: 50 });
    const byId = new Map([e1, e2].map((e) => [e.id, e]));
    const build: PokemonBuild = {
      name: "b",
      heldItemIds: [],
      emblems: [
        { emblemId: "a", grade: "gold" },
        { emblemId: "b", grade: "gold" },
      ],
    };
    const totals = buildStatTotals(build, byId);
    expect(totals.spAttack).toBe(3);
    expect(totals.hp).toBe(0); // -50 + 50
  });
});

// ---------------------------------------------------------------------------
// derivePriorities — flat + set-bonus intent
// ---------------------------------------------------------------------------

describe("derivePriorities", () => {
  it("[GEN-7] dominant stat is normalized to 1.0", () => {
    const p = derivePriorities(
      [{ attack: 14, hp: 100 }],
      { brown: 6 },
      statBlock({ attack: 300, hp: 9000 }),
      SET_BONUSES,
    );
    expect(Math.max(...Object.values(p))).toBe(1);
  });

  it("[GEN-8] set-bonus intent lifts the offensive stat (vs flat-only)", () => {
    const totals = [{ hp: 300, spAttack: 2 }];
    const base = statBlock({ spAttack: 280, hp: 8000 });
    const withShell = derivePriorities(totals, { green: 6 }, base, SET_BONUSES);
    const noShell = derivePriorities(totals, {}, base, SET_BONUSES);
    expect(withShell.spAttack ?? 0).toBeGreaterThan(noShell.spAttack ?? 0);
    expect(withShell.spAttack ?? 0).toBeGreaterThan(0.3);
  });

  it("[GEN-9] drops stats below MIN_PRIORITY and returns {} for no investment", () => {
    expect(derivePriorities([{}], {}, statBlock(), SET_BONUSES)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// deriveProtectedFloors — p10 clamp + mobility
// ---------------------------------------------------------------------------

describe("deriveProtectedFloors", () => {
  it("[GEN-10] positive investment with non-negative p10 → floor 0", () => {
    const floors = deriveProtectedFloors([{ hp: 300 }, { hp: 250 }]);
    expect(floors.hp).toBe(0);
  });

  it("[GEN-11] community-tolerated negative tax becomes a negative floor", () => {
    const floors = deriveProtectedFloors([{ defense: -10 }, { defense: -6 }]);
    expect(floors.defense).toBeLessThan(0);
  });

  it("[GEN-12] moveSpeed floor 0 when all builds keep it ≥ 0", () => {
    const floors = deriveProtectedFloors([{ moveSpeed: 20 }, { moveSpeed: 0 }]);
    expect(floors.moveSpeed).toBe(0);
  });

  it("[GEN-13] moveSpeed floor negative when a build nets it below 0", () => {
    const floors = deriveProtectedFloors([{ moveSpeed: 20 }, { moveSpeed: -35 }]);
    expect(floors.moveSpeed).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// deriveColorTargets — vote-weighted aggregation
// ---------------------------------------------------------------------------

describe("deriveColorTargets", () => {
  it("[GEN-14] keeps colors with weighted count ≥ 2", () => {
    const { build, byId } = buildFromColors([
      "green",
      "green",
      "green",
      "green",
      "green",
      "green",
      "white",
      "white",
      "white",
      "white",
    ]);
    const targets = deriveColorTargets([{ build, weight: 1 }], byId);
    expect(targets.green).toBe(6);
    expect(targets.white).toBe(4);
  });

  it("[GEN-15] drops a singleton color below the threshold", () => {
    const { build, byId } = buildFromColors([
      "green",
      "green",
      "green",
      "green",
      "green",
      "green",
      "green",
      "green",
      "green",
      "white",
    ]);
    const targets = deriveColorTargets([{ build, weight: 1 }], byId);
    expect(targets.green).toBe(9);
    expect(targets.white).toBeUndefined(); // only 1 white → below MIN_COLOR_COUNT
  });

  it("[GEN-16] Creative builds vote at half weight", () => {
    const rec = buildFromColors(Array(10).fill("green"));
    const creative = buildFromColors(Array(10).fill("white"));
    const byId = new Map([...rec.byId, ...creative.byId]);
    const targets = deriveColorTargets(
      [
        { build: rec.build, weight: 1 },
        { build: creative.build, weight: 0.5 },
      ],
      byId,
    );
    // green: (1*10)/1.5 = 6.67 → 7 ; white: (0.5*10)/1.5 = 3.33 → 3
    expect(targets.green).toBe(7);
    expect(targets.white).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Color target tier snaps
// ---------------------------------------------------------------------------

describe("color target tier snaps", () => {
  it("[GEN-16b] snapColorTargetUp only when one emblem below the next tier", () => {
    expect(snapColorTargetUp(5, BROWN_SB)).toBe(6);
    expect(snapColorTargetUp(4, BROWN_SB)).toBe(4);
    expect(snapColorTargetUp(3, BROWN_SB)).toBe(4);
  });

  it("[GEN-16c] snapColorTargetDownOneTier drops to the top of the lower band", () => {
    expect(snapColorTargetDownOneTier(4, BLACK_SB)).toBe(2);
    expect(snapColorTargetDownOneTier(5, BROWN_SB)).toBe(3);
  });

  it("[GEN-16d] leastDominantColorTarget drops lowest priority-weighted keep value", () => {
    const bonusByColor = new Map([
      [BROWN_SB.color, BROWN_SB],
      [WHITE_SB.color, WHITE_SB],
      [BLACK_SB.color, BLACK_SB],
    ]);
    const targets = { brown: 5, white: 4, black: 4 };
    const priorities = { attack: 1, hp: 0.77, cdr: 0.05 };
    expect(leastDominantColorTarget(targets, priorities, bonusByColor)).toBe("black");
  });

  it("[GEN-16e] colorTargetSnapUpOrder prefers higher priority-weighted tier gain at same count", () => {
    const bonusByColor = new Map([
      [BROWN_SB.color, BROWN_SB],
      [WHITE_SB.color, WHITE_SB],
    ]);
    const targets = { brown: 5, white: 5 };
    const attackFirst = { attack: 1, hp: 0.2 };
    expect(colorTargetSnapUpOrder(targets, attackFirst, bonusByColor)[0]).toBe("brown");
    const hpFirst = { attack: 0.2, hp: 1 };
    expect(colorTargetSnapUpOrder(targets, hpFirst, bonusByColor)[0]).toBe("white");
  });
});

// ---------------------------------------------------------------------------
// Confidence — robust to a single outlier build
// ---------------------------------------------------------------------------

describe("computeConfidence", () => {
  it("[GEN-17] buildDistances measures distance from the median build", () => {
    const d = buildDistances([{ hp: 150 }, { hp: 150 }, { hp: 150 }, { hp: -100 }]);
    expect(d.filter((x) => x === 0)).toHaveLength(3);
    expect(d[3]).toBeGreaterThan(0);
  });

  it("[GEN-18] a single outlier among consistent builds keeps confidence high", () => {
    const totals = [
      { hp: 150, attack: 13 },
      { hp: 150, attack: 13 },
      { hp: 150, attack: 13 },
      { hp: -100, attack: -7 },
    ];
    expect(computeConfidence(4, totals)).toBeGreaterThanOrEqual(0.9);
  });

  it("[GEN-19] a single build scores ~0.5 (data-thin)", () => {
    expect(computeConfidence(1, [{ hp: 150 }])).toBeCloseTo(0.5);
  });

  it("[GEN-20] genuinely divergent builds score lower", () => {
    const consistent = computeConfidence(2, [
      { hp: 300, attack: 14 },
      { hp: 300, attack: 14 },
    ]);
    const divergent = computeConfidence(2, [
      { hp: 600, attack: 0 },
      { hp: 0, attack: 28 },
    ]);
    expect(divergent).toBeLessThan(consistent);
  });

  it("[GEN-20b] mobility variant pair passes (moveSpeed excluded from distance)", () => {
    // Skeledirge / Miraidon pattern: standard green shell vs mobility shell.
    const standard = { hp: 350, attack: -9.8, defense: 5, spAttack: 1.5, spDefense: -8 };
    const mobile = { hp: 200, attack: -15, spAttack: 4.5, moveSpeed: 140 };
    expect(computeConfidence(2, [standard, mobile])).toBeGreaterThanOrEqual(0.4);
  });
});

// ---------------------------------------------------------------------------
// generatePresetForPokemon — end-to-end + fallback
// ---------------------------------------------------------------------------

function makePokemon(builds: PokemonBuild[], creativeBuilds: PokemonBuild[] = []): Pokemon {
  return {
    id: "test",
    displayName: "Test",
    role: "Attacker",
    attackType: "special",
    difficulty: 1,
    imageAsset: "",
    iconAsset: "",
    evolutions: [],
    baseStatsByLevel: Array.from({ length: 15 }, () => statBlock({ spAttack: 280, hp: 8000 })),
    moves: [],
    passiveAbility: { id: "p", name: "", description: "", effects: [] },
    builds,
    creativeBuilds,
  };
}

describe("generatePresetForPokemon", () => {
  function greenBuild(name: string): { build: PokemonBuild; emblems: Emblem[] } {
    const emblems = [
      ...Array.from({ length: 6 }, (_, i) =>
        makeEmblem(`g${name}${i}`, ["green"], { spAttack: 3, hp: -50 }),
      ),
      ...Array.from({ length: 4 }, (_, i) => makeEmblem(`w${name}${i}`, ["white"], { hp: 50 })),
    ];
    return {
      build: {
        name,
        heldItemIds: [],
        emblems: emblems.map((e) => ({ emblemId: e.id, grade: "gold" as const })),
      },
      emblems,
    };
  }

  it("[GEN-21] produces a well-formed preset from consistent builds", () => {
    const b1 = greenBuild("a");
    const b2 = greenBuild("b");
    const byId = new Map([...b1.emblems, ...b2.emblems].map((e) => [e.id, e]));
    const pokemon = makePokemon([b1.build, b2.build]);

    const preset = generatePresetForPokemon(pokemon, byId, SET_BONUSES, [
      ...b1.emblems,
      ...b2.emblems,
    ]);
    expect(preset).not.toBeNull();
    expect(preset!.source).toBe("auto");
    expect(preset!.buildCount).toBe(2);
    expect(preset!.colorTargets.green).toBe(6);
    expect(preset!.colorTargets.white).toBe(4);
    // Set-bonus intent → spAttack is a real priority despite small flat values.
    expect(preset!.priorities.spAttack ?? 0).toBeGreaterThan(0);
    expect(preset!.confidence ?? 0).toBeGreaterThanOrEqual(0.4);
  });

  it("[GEN-22] no usable builds → null (falls back to generic)", () => {
    const pokemon = makePokemon([]);
    expect(generatePresetForPokemon(pokemon, new Map(), SET_BONUSES, [])).toBeNull();
  });

  it("[GEN-23] low confidence (one divergent pair) → null", () => {
    // Two wildly different single builds → low confidence below threshold.
    const a = greenBuild("x");
    const bEmblems = Array.from({ length: 10 }, (_, i) =>
      makeEmblem(`brown${i}`, ["brown"], { attack: 8, hp: -50, moveSpeed: -35 }),
    );
    const bBuild: PokemonBuild = {
      name: "y",
      heldItemIds: [],
      emblems: bEmblems.map((e) => ({ emblemId: e.id, grade: "gold" as const })),
    };
    const byId = new Map([...a.emblems, ...bEmblems].map((e) => [e.id, e]));
    const pokemon = makePokemon([a.build, bBuild]);
    expect(
      generatePresetForPokemon(pokemon, byId, SET_BONUSES, [...a.emblems, ...bEmblems]),
    ).toBeNull();
  });

  it("[GEN-24] snaps averaged shell onto feasible bonus tiers (quaquaval)", () => {
    const bundle = loadBundle(rawPatch);
    const byId = new Map(bundle.emblems.map((e) => [e.id, e]));
    const pokemon = bundle.pokemon.find((p) => p.id === "quaquaval");
    expect(pokemon).toBeDefined();

    const preset = generatePresetForPokemon(pokemon!, byId, bundle.setBonuses, bundle.emblems);
    expect(preset).not.toBeNull();
    expect(preset!.colorTargets).toEqual({ brown: 6, white: 4, black: 2 });
    expect(preset!.priorities.attack).toBe(1);
  });
});
