// End-to-end stacking-order tests (docs/03-Calculation-Engine.md):
//   base -> +emblem flats (std rounding) -> *set-bonus % -> +item flats -> conditionals

import { describe, expect, it } from "vitest";
import { computeEffectiveStats, outOfCombatMoveSpeed } from "../formulas";
import { computeEmblemLoadout } from "../emblems";
import {
  attackWeight,
  aerodactyl,
  bundle,
  diglett,
  distinctEmblems,
  floatStone,
  gold,
  IN_COMBAT,
  lucario,
  OUT_OF_COMBAT,
} from "./fixtures";

const setBonuses = bundle.setBonuses;
const noEmblems = computeEmblemLoadout([], setBonuses);

describe("Lucario level-15 base (documented validation target)", () => {
  it("matches HP 7249 / Atk 429 / Def 390 / SpAtk 115 / SpDef 300 / Crit 20% / AS 40% / MS 4300", () => {
    const stats = computeEffectiveStats(lucario, 15, noEmblems, [], [], IN_COMBAT);
    expect(stats).toEqual({
      hp: 7249,
      attack: 429,
      defense: 390,
      spAttack: 115,
      spDefense: 300,
      critRate: 0.2,
      cdr: 0,
      lifesteal: 0.15,
      spLifesteal: 0,
      attackSpeed: 0.4,
      moveSpeed: 4300,
    });
  });

  it("level 1 base also passes through untouched", () => {
    const stats = computeEffectiveStats(lucario, 1, noEmblems, [], [], IN_COMBAT);
    expect(stats.hp).toBe(3250);
    expect(stats.attack).toBe(160);
  });
});

describe("stacking order (the #1 source of third-party inaccuracy)", () => {
  it("6 Brown multiplies (base + emblem flats), THEN held-item flats add after", () => {
    // 6 × 16.7 atk = 100.2 -> rounds to 100 (large flats chosen so each wrong
    // ordering yields a DIFFERENT number).
    const emblems = computeEmblemLoadout(
      distinctEmblems(6, ["brown"], { attack: 16.7 }),
      setBonuses,
    );
    const stats = computeEffectiveStats(lucario, 15, emblems, [floatStone], [40], IN_COMBAT);
    // correct:               floor((429+100) * 1.04) + 28 = 550 + 28  = 578
    // item flats inside %:   floor((429+100+28) * 1.04)   = 579   (wrong)
    // flats not multiplied:  floor(429*1.04) + 100 + 28   = 574   (wrong)
    expect(stats.attack).toBe(578);
    // Float Stone's move speed is a plain flat (no set bonus touches it here).
    expect(stats.moveSpeed).toBe(4300 + 175);
  });

  it("emblem flats round 18.6 -> 19 before the multiply", () => {
    const emblems = computeEmblemLoadout(
      distinctEmblems(6, ["brown"], { attack: 3.1 }),
      setBonuses,
    );
    const stats = computeEffectiveStats(lucario, 15, emblems, [], [], IN_COMBAT);
    // floor((429 + 19) * 1.04) = floor(465.92) = 465
    expect(stats.attack).toBe(465);
  });

  it("set-bonus result truncates (game math truncates outside emblem flats)", () => {
    const emblems = computeEmblemLoadout(
      distinctEmblems(4, ["brown"], { attack: 4.6 }),
      setBonuses,
    );
    const stats = computeEffectiveStats(lucario, 15, emblems, [], [], IN_COMBAT);
    // 4 × 4.6 = 18.4 -> 18; floor((429+18) * 1.02) = floor(455.94) = 455
    expect(stats.attack).toBe(455);
  });
});

describe("percent-domain set bonuses add percentage points", () => {
  it("7 Red: attack speed 0.40 -> 0.48 (not ×1.08)", () => {
    const emblems = computeEmblemLoadout(distinctEmblems(7, ["red"]), setBonuses);
    const stats = computeEffectiveStats(lucario, 15, emblems, [], [], IN_COMBAT);
    expect(stats.attackSpeed).toBeCloseTo(0.48, 9);
  });

  it("3 Black: CDR 0 -> 0.02 (multiplying a 0 base would do nothing)", () => {
    const emblems = computeEmblemLoadout(distinctEmblems(3, ["black"]), setBonuses);
    const stats = computeEffectiveStats(lucario, 15, emblems, [], [], IN_COMBAT);
    expect(stats.cdr).toBeCloseTo(0.02, 9);
  });
});

describe("yellow set bonus is out-of-combat only", () => {
  const emblems = computeEmblemLoadout(distinctEmblems(7, ["yellow"]), setBonuses);

  it("applies out of combat: floor(4300 × 1.12) = 4816", () => {
    const stats = computeEffectiveStats(lucario, 15, emblems, [], [], OUT_OF_COMBAT);
    expect(stats.moveSpeed).toBe(4816);
  });

  it("does not apply in combat", () => {
    const stats = computeEffectiveStats(lucario, 15, emblems, [], [], IN_COMBAT);
    expect(stats.moveSpeed).toBe(4300);
  });
});

describe("real bundle emblems (Diglett / Aerodactyl)", () => {
  it("Diglett+Aerodactyl: 2 brown (+1% Atk), negative flats, summed move speed", () => {
    const emblems = computeEmblemLoadout([gold(diglett), gold(aerodactyl)], setBonuses);
    const stats = computeEffectiveStats(lucario, 15, emblems, [], [], IN_COMBAT);
    expect(stats.attack).toBe(Math.floor(429 * 1.01)); // 433, no attack flats
    expect(stats.hp).toBe(7249 - 50);
    expect(stats.defense).toBe(390 - 5);
    expect(stats.moveSpeed).toBe(4300 + 70);
  });

  it("duplicate Diglett: flats stack but brown counts once (no bonus)", () => {
    const emblems = computeEmblemLoadout(
      [
        { emblem: diglett, grade: "bronze" },
        { emblem: diglett, grade: "gold" },
      ],
      setBonuses,
    );
    const stats = computeEffectiveStats(lucario, 15, emblems, [], [], IN_COMBAT);
    expect(stats.attack).toBe(429); // no 2-brown bonus
    expect(stats.hp).toBe(7249 - 80);
    expect(stats.moveSpeed).toBe(4300 + 56);
  });
});

describe("conditional item effects", () => {
  it("Attack Weight: +12 attack per goal scored", () => {
    const stats = computeEffectiveStats(lucario, 15, noEmblems, [attackWeight], [40], {
      inCombat: true,
      goalsScored: 2,
    });
    // 429 + 21 (grade-40 flat) + 12×2
    expect(stats.attack).toBe(474);
  });

  it("Float Stone grade-40 flats: +28 Atk, +175 MS (documented target)", () => {
    const stats = computeEffectiveStats(lucario, 15, noEmblems, [floatStone], [40], IN_COMBAT);
    expect(stats.attack).toBe(429 + 28);
    expect(stats.moveSpeed).toBe(4300 + 175);
  });

  it("Float Stone +20% move speed applies only out of combat (display layer)", () => {
    const stats = computeEffectiveStats(lucario, 15, noEmblems, [floatStone], [40], OUT_OF_COMBAT);
    expect(outOfCombatMoveSpeed(stats, [floatStone], OUT_OF_COMBAT)).toBe(
      Math.floor((4300 + 175) * 1.2), // 5370
    );
    expect(outOfCombatMoveSpeed(stats, [floatStone], IN_COMBAT)).toBe(4475);
  });
});
