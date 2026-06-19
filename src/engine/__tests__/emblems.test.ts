import { describe, expect, it } from "vitest";
import { activeBonusPercent, computeEmblemLoadout, countColors, sumEmblemFlats } from "../emblems";
import { aerodactyl, bundle, diglett, distinctEmblems, gold, makeEmblem } from "./fixtures";

const setBonuses = bundle.setBonuses;

describe("activeBonusPercent (threshold selection)", () => {
  const brown = { 2: 0.01, 4: 0.02, 6: 0.04 };
  const red = { 3: 0.02, 5: 0.04, 7: 0.08 };

  it("picks the highest threshold met (2/4/6 colors)", () => {
    expect(activeBonusPercent(1, brown)).toBeNull();
    expect(activeBonusPercent(2, brown)).toBe(0.01);
    expect(activeBonusPercent(3, brown)).toBe(0.01);
    expect(activeBonusPercent(5, brown)).toBe(0.02);
    expect(activeBonusPercent(6, brown)).toBe(0.04);
    expect(activeBonusPercent(10, brown)).toBe(0.04);
  });

  it("picks the highest threshold met (3/5/7 colors)", () => {
    expect(activeBonusPercent(2, red)).toBeNull();
    expect(activeBonusPercent(3, red)).toBe(0.02);
    expect(activeBonusPercent(6, red)).toBe(0.04);
    expect(activeBonusPercent(7, red)).toBe(0.08);
  });
});

describe("countColors", () => {
  it("a 2-color emblem counts toward BOTH colors", () => {
    const counts = countColors([gold(aerodactyl)]);
    expect(counts.get("brown")).toBe(1);
    expect(counts.get("white")).toBe(1);
  });

  it("duplicates of the same Pokémon count once per color", () => {
    const counts = countColors([
      { emblem: diglett, grade: "bronze" },
      { emblem: diglett, grade: "gold" },
    ]);
    expect(counts.get("brown")).toBe(1);
  });

  it("distinct Pokémon accumulate", () => {
    const counts = countColors([gold(diglett), gold(aerodactyl)]);
    expect(counts.get("brown")).toBe(2);
    expect(counts.get("white")).toBe(1);
  });
});

describe("sumEmblemFlats", () => {
  it("sums raw flats without rounding", () => {
    const slots = distinctEmblems(6, ["brown"], { attack: 3.1 });
    const flats = sumEmblemFlats(slots);
    expect(flats.attack).toBeCloseTo(18.6, 9);
  });

  it("duplicate Pokémon flats STILL stack (only color counting dedupes)", () => {
    const flats = sumEmblemFlats([
      { emblem: diglett, grade: "bronze" }, // hp -30, ms +21
      { emblem: diglett, grade: "gold" }, //   hp -50, ms +35
    ]);
    expect(flats.hp).toBe(-80);
    expect(flats.moveSpeed).toBe(56);
  });

  it("platinum uses gold's values", () => {
    const flats = sumEmblemFlats([{ emblem: diglett, grade: "platinum" }]);
    expect(flats.hp).toBe(-50);
    expect(flats.moveSpeed).toBe(35);
  });
});

describe("computeEmblemLoadout", () => {
  it("activates the right set bonuses from the bundle table", () => {
    const loadout = computeEmblemLoadout(distinctEmblems(6, ["brown"]), setBonuses);
    expect(loadout.activeSetBonuses).toEqual([{ color: "brown", bonusPercent: 0.04 }]);
  });

  it("no bonus below the lowest threshold", () => {
    const loadout = computeEmblemLoadout(
      distinctEmblems(2, ["red"]), // red needs 3
      setBonuses,
    );
    expect(loadout.activeSetBonuses).toEqual([]);
  });

  it("navy/gray emblems never produce a bonus (absent from table)", () => {
    const loadout = computeEmblemLoadout(distinctEmblems(7, ["navy"]), setBonuses);
    expect(loadout.activeSetBonuses).toEqual([]);
  });

  it("mixed loadout activates multiple colors at once", () => {
    const slots = [
      ...distinctEmblems(4, ["brown"], { attack: 1 }),
      ...distinctEmblems(3, ["black"]),
      gold(makeEmblem("DualBW", ["brown", "white"])),
    ];
    const loadout = computeEmblemLoadout(slots, setBonuses);
    const byColor = Object.fromEntries(
      loadout.activeSetBonuses.map((b) => [b.color, b.bonusPercent]),
    );
    expect(byColor.brown).toBe(0.02); // 5 brown -> threshold 4
    expect(byColor.black).toBe(0.02); // 3 black -> threshold 3
    expect(byColor.white).toBeUndefined(); // 1 white -> none
    expect(loadout.flatTotals.attack).toBe(4);
  });

  it("rejects more than 10 slots", () => {
    expect(() => computeEmblemLoadout(distinctEmblems(11, ["brown"]), setBonuses)).toThrow(
      /max is 10/,
    );
  });
});
