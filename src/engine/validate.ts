// Known-values validation gate (docs/03-Calculation-Engine.md §Validation
// Targets). Run with `npm run validate`. Exits 1 on any failure — this is the
// gate before UI work and before accepting a new data bundle.

import { readFileSync } from "node:fs";
import { loadBundle } from "../data/loadBundle";
import { computeEmblemLoadout } from "./emblems";
import { computeEffectiveStats, roundEmblemTotals } from "./formulas";
import type { Emblem, EmblemSlot, GameDataBundle } from "../types";

const bundlePath = new URL("../data/example-lucario.json", import.meta.url);
const raw = JSON.parse(readFileSync(bundlePath, "utf8"));

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failures++;
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${name}` +
      (pass ? "" : `\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`),
  );
}

const bundle: GameDataBundle = loadBundle(raw);
console.log(`Loaded bundle ${bundle.patchVersion} (zod validation passed)\n`);

// --- 1. Lucario Lv15 base stats -------------------------------------------
const lucario = bundle.pokemon.find((p) => p.id === "lucario")!;
const noEmblems = computeEmblemLoadout([], bundle.setBonuses);
const ctx = { inCombat: true, goalsScored: 0 };
const lv15 = computeEffectiveStats(lucario, 15, noEmblems, [], [], ctx);
check("Lucario Lv15 HP = 7249", lv15.hp, 7249);
check("Lucario Lv15 Attack = 429", lv15.attack, 429);
check("Lucario Lv15 Defense = 390", lv15.defense, 390);
check("Lucario Lv15 SpAtk = 115", lv15.spAttack, 115);
check("Lucario Lv15 SpDef = 300", lv15.spDefense, 300);
check("Lucario Lv15 Crit = 20%", lv15.critRate, 0.2);
check("Lucario Lv15 AtkSpeed = 40%", lv15.attackSpeed, 0.4);
check("Lucario Lv15 MoveSpeed = 4300", lv15.moveSpeed, 4300);

// --- 2. Emblem rounding -----------------------------------------------------
check("Emblem flats 18.6 -> 19", roundEmblemTotals({ attack: 18.6 }).attack, 19);
check("Emblem flats 18.4 -> 18", roundEmblemTotals({ attack: 18.4 }).attack, 18);

// --- 3. Stacking order: 6 Brown then held-item flats ------------------------
function syntheticBrown(i: number, attack: number): EmblemSlot {
  const emblem: Emblem = {
    id: `synthetic-${i}`,
    pokemonName: `Synthetic${i}`,
    colors: ["brown"],
    iconAsset: "",
    statsByGrade: {
      bronze: { attack },
      silver: { attack },
      gold: { attack },
    },
  };
  return { emblem, grade: "gold" };
}
const sixBrown = computeEmblemLoadout(
  Array.from({ length: 6 }, (_, i) => syntheticBrown(i, 16.7)),
  bundle.setBonuses,
);
const floatStone = bundle.heldItems.find((i) => i.id === "float-stone")!;
const ordered = computeEffectiveStats(lucario, 15, sixBrown, [floatStone], [40], ctx);
// floor((429 + round(100.2)) * 1.04) + 28 = floor(550.16) + 28 = 578
// (item-flats-inside-% would give 579; flats-not-multiplied would give 574)
check("6 Brown ×(base+flats), item flat AFTER -> Atk 578", ordered.attack, 578);

// --- 4. Float Stone grade-40 values (documented target) ---------------------
check("Float Stone G40 +28 Attack", floatStone.statsByGrade[40]?.attack, 28);
check("Float Stone G40 +175 MoveSpeed", floatStone.statsByGrade[40]?.moveSpeed, 175);
const ooc = floatStone.conditionalEffects.find((e) => e.type === "outOfCombat")!;
check("Float Stone +20% OOC effect", [ooc.value, ooc.appliesInCombat], [0.2, false]);

// --- 5. Malformed bundle fails loudly ---------------------------------------
const corrupt = structuredClone(raw);
corrupt.pokemon[0].baseStatsByLevel.pop(); // 14 levels instead of 15
let threw = false;
try {
  loadBundle(corrupt);
} catch {
  threw = true;
}
check("Corrupt bundle (14 level rows) throws", threw, true);

console.log(
  failures === 0 ? "\nAll validation targets PASS." : `\n${failures} validation target(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
