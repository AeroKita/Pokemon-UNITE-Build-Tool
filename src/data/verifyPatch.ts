// Verifies the normalized community bundle: zod-validates it, then checks the
// engine reproduces known in-game targets. Run: npx tsx src/data/verifyPatch.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadBundle } from "./loadBundle";
import { computeEffectiveStats } from "../engine/formulas";
import { computeEmblemLoadout } from "../engine/emblems";
import type { CalcContext } from "../types";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(here, "patch-current.json"), "utf8"));

let pass = 0;
let fail = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got ${got}, want ${want}`}`);
  if (ok) pass++;
  else fail++;
}

const bundle = loadBundle(raw);
console.log(`Loaded bundle ${bundle.patchVersion} (zod OK) — ${bundle.pokemon.length} pokemon\n`);

// --- Lucario Lv15 base stats (engine validation targets) ---
const lucario = bundle.pokemon.find((p) => p.id === "lucario")!;
const l15 = lucario.baseStatsByLevel[14];
check("Lucario Lv15 HP = 7249", l15.hp, 7249);
check("Lucario Lv15 Attack = 429", l15.attack, 429);
check("Lucario Lv15 Defense = 390", l15.defense, 390);
check("Lucario Lv15 SpAtk = 115", l15.spAttack, 115);
check("Lucario Lv15 SpDef = 300", l15.spDefense, 300);
check("Lucario Lv15 Crit = 0.20", l15.critRate, 0.2);
check("Lucario Lv15 AtkSpeed = 0.40", l15.attackSpeed, 0.4);
check("Lucario Lv15 MoveSpeed = 4300", l15.moveSpeed, 4300);

// --- Held items: max-level (40) flats ---
const floatStone = bundle.heldItems.find((i) => i.id === "float-stone")!;
check("Float Stone +28 Attack", floatStone.statsByGrade[40].attack, 28);
check("Float Stone +175 MoveSpeed", floatStone.statsByGrade[40].moveSpeed, 175);
const muscle = bundle.heldItems.find((i) => i.id === "muscle-band")!;
check("Muscle Band +17.5 Attack", muscle.statsByGrade[40].attack, 17.5);
check("Muscle Band +8.75% AtkSpeed", muscle.statsByGrade[40].attackSpeed, 0.0875);
const wise = bundle.heldItems.find((i) => i.id === "wise-glasses")!;
check("Wise Glasses +44 SpAtk", wise.statsByGrade[40].spAttack, 44);

// --- Set bonuses: Brown 2/4/6 = +1/2/4% Attack ---
const brown = bundle.setBonuses.find((s) => s.color === "brown")!;
check("Brown set stat = attack", brown.stat, "attack");
check("Brown 6 = +0.04 Attack", brown.thresholds[6], 0.04);

// --- End-to-end: 6 Brown set bonus multiplies (base+flats), item flats added after ---
// Pick 6 distinct brown emblems (gold) to trigger the 6-threshold.
const brownEmblems = bundle.emblems
  .filter((e) => e.colors.includes("brown"))
  .slice(0, 6)
  .map((emblem) => ({ emblem, grade: "gold" as const }));
const loadout = computeEmblemLoadout(brownEmblems, bundle.setBonuses);
const ctx: CalcContext = { inCombat: true, goalsScored: 0 };
const eff = computeEffectiveStats(lucario, 15, loadout, [floatStone], [40], ctx);
console.log(
  `\n6-Brown loadout: ${loadout.activeSetBonuses.map((b) => `${b.color}+${b.bonusPercent}`).join(", ") || "none"}`,
);
const brownActive = loadout.activeSetBonuses.find((b) => b.color === "brown");
check("6 Brown emblems => brown bonus active 0.04", brownActive?.bonusPercent, 0.04);
console.log(`Lucario Lv15 Attack with 6-Brown + Float Stone: ${eff.attack}`);

console.log(`\n${fail === 0 ? "All checks PASS" : `${fail} FAILED`} (${pass} passed)`);
if (fail > 0) process.exit(1);
