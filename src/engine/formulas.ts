// Pokémon UNITE Build Optimizer — Pure Calculation Functions
// These mirror in-game behavior. Keep them pure and unit-tested.
//
// Stacking order and rounding rules come from docs/03-Calculation-Engine.md.
// Deviations from the original schema/formulas.ts draft (each verified against
// that doc):
//   - Value stats are TRUNCATED after the set-bonus multiply ("most other game
//     math truncates"; emblem flats are the only standard-rounding site).
//   - attackSpeed / cdr set bonuses add percentage POINTS (red "+2% Atk Speed"
//     means +0.02 to the stat, not ×1.02 — multiplying a base-0 CDR would make
//     black emblems do nothing).
//   - Yellow's move-speed bonus is out-of-combat only, gated on context.

import type {
  StatBlock,
  Pokemon,
  EmblemLoadout,
  HeldItem,
  CalcContext,
  EmblemColor,
} from "../types";

// ----- Damage (RSB) ----------------------------------------------------------

/** Raw damage: FLOOR(R * stat + S * (level - 1) + B) */
export function rawDamage(
  ratio: number,
  stat: number,
  slider: number,
  level: number,
  base: number,
): number {
  return Math.floor(ratio * stat + slider * (level - 1) + base);
}

// ----- Defense / mitigation --------------------------------------------------

/** Physical damage taken: FLOOR(raw * 600 / (600 + Def)) */
export function physicalDamageTaken(raw: number, defense: number): number {
  return Math.floor((raw * 600) / (600 + defense));
}

/** Special damage taken: FLOOR(raw * 600 / (600 + SpDef)) */
export function specialDamageTaken(raw: number, spDefense: number): number {
  return Math.floor((raw * 600) / (600 + spDefense));
}

/**
 * Damage taken with flat damage reduction (reductions stack ADDITIVELY):
 * FLOOR( FLOOR(raw * 600 / (600 + Def)) * (1 - reduction) )
 */
export function damageTakenWithReduction(raw: number, defense: number, reduction: number): number {
  return Math.floor(physicalDamageTaken(raw, defense) * (1 - reduction));
}

// ----- Effective HP ----------------------------------------------------------

/** Effective HP: MaxHP * (1 + Def/600). Use SpDef for special eHP. */
export function effectiveHp(maxHp: number, defenseOrSpDef: number): number {
  return maxHp * (1 + defenseOrSpDef / 600);
}

// ----- Emblem flat rounding --------------------------------------------------

/**
 * Total emblem flats use STANDARD rounding (e.g. 18.6 -> 19, 18.4 -> 18).
 * Apply to the SUMMED flats, not per-emblem.
 */
export function roundEmblemTotals(flats: Partial<StatBlock>): Partial<StatBlock> {
  const out: Partial<StatBlock> = {};
  for (const key of Object.keys(flats) as (keyof StatBlock)[]) {
    const v = flats[key];
    if (v !== undefined) out[key] = Math.round(v);
  }
  return out;
}

// ----- Effective stats (STACKING ORDER) --------------------------------------

/**
 * Stats whose in-game value is a whole number; these truncate after the
 * set-bonus multiply. Percent-domain stats (critRate, cdr, attackSpeed,
 * lifesteal) stay fractional.
 */
const INTEGER_STATS: ReadonlySet<keyof StatBlock> = new Set([
  "hp",
  "attack",
  "defense",
  "spAttack",
  "spDefense",
  "moveSpeed",
] as const);

/**
 * Stats that are themselves percentages. Their set bonuses add percentage
 * points instead of multiplying (e.g. 7 Red: attackSpeed 0.40 -> 0.48).
 */
const PERCENT_POINT_STATS: ReadonlySet<keyof StatBlock> = new Set(["attackSpeed", "cdr"] as const);

/**
 * Compute a Pokémon's effective stats at a given level with the chosen
 * emblems and held items.
 *
 * ORDER (do not change):
 *   1. base stat at level
 *   2. + emblem flat totals (rounded, standard rounding)
 *   3. * emblem set-bonus % applied to (base + emblem flats)
 *   4. + held-item flat stats (NOT multiplied by emblem %)
 *   5. + conditional item effects per context
 */
export function computeEffectiveStats(
  pokemon: Pokemon,
  level: number, // 1-15
  emblems: EmblemLoadout,
  items: HeldItem[],
  itemGrades: number[], // parallel to items, each 1–40
  context: CalcContext,
): StatBlock {
  // 1. Base stat at the given level
  const stats: StatBlock = { ...pokemon.baseStatsByLevel[level - 1] };

  // 2. Emblem flat totals (rounded once, on the summed totals)
  const emblemFlats = roundEmblemTotals(emblems.flatTotals);

  // Track which stats received a set-bonus multiply so we don't double-add.
  const bonusedStats = new Set<keyof StatBlock>();

  // 3. Emblem set-bonus % applied to (base + emblem flats)
  for (const bonus of emblems.activeSetBonuses) {
    const stat = setBonusStat(bonus.color);
    if (!stat) continue;
    // Yellow's bonus is out-of-combat move speed only.
    if (bonus.color === "yellow" && context.inCombat) continue;
    const baseVal = stats[stat];
    const flatVal = emblemFlats[stat] ?? 0;
    if (PERCENT_POINT_STATS.has(stat)) {
      // Percentage-point bonus: additive on the percent-domain stat.
      stats[stat] = baseVal + flatVal + bonus.bonusPercent;
    } else {
      stats[stat] = (baseVal + flatVal) * (1 + bonus.bonusPercent);
      if (INTEGER_STATS.has(stat)) stats[stat] = Math.floor(stats[stat]);
    }
    bonusedStats.add(stat);
  }

  // Add any emblem flats that were NOT touched by a set bonus.
  for (const key of Object.keys(emblemFlats) as (keyof StatBlock)[]) {
    if (!bonusedStats.has(key)) {
      stats[key] = (stats[key] ?? 0) + (emblemFlats[key] ?? 0);
    }
  }

  // 4. Held-item flat stats (added AFTER emblem %)
  for (let i = 0; i < items.length; i++) {
    const grade = itemGrades[i] ?? 40; // default to max grade
    const gradeStats = items[i].statsByGrade[grade] ?? {};
    for (const key of Object.keys(gradeStats) as (keyof StatBlock)[]) {
      stats[key] = (stats[key] ?? 0) + (gradeStats[key] ?? 0);
    }
  }

  // 5. Conditional item effects (stacking buffs, OOC effects, etc.)
  for (const item of items) {
    for (const effect of item.conditionalEffects) {
      // Example: Attack Weight stacks per goal scored.
      if (effect.stacking && effect.type === "onScore" && effect.stackValue) {
        const stacks = Math.min(context.goalsScored, effect.maxStacks ?? context.goalsScored);
        stats.attack += effect.stackValue * stacks;
      }
      // % OOC move speed (Float Stone) is applied at the display layer via
      // outOfCombatMoveSpeed() — it is not part of the core stat block.
      // Extend with additional effect handlers as needed.
    }
  }

  return stats;
}

/**
 * Display-layer move speed when out of combat: applies % OOC item effects
 * (e.g. Float Stone +20%) on top of the already-computed effective move speed.
 * OOC percentages stack additively. When in combat, this is just the
 * effective move speed.
 */
export function outOfCombatMoveSpeed(
  effectiveStats: StatBlock,
  items: HeldItem[],
  context: CalcContext,
): number {
  if (context.inCombat) return effectiveStats.moveSpeed;
  let oocPercent = 0;
  for (const item of items) {
    for (const effect of item.conditionalEffects) {
      if (effect.type === "outOfCombat" && effect.appliesInCombat === false && effect.value) {
        oocPercent += effect.value;
      }
    }
  }
  return Math.floor(effectiveStats.moveSpeed * (1 + oocPercent));
}

/** Maps an emblem color to the stat its set bonus modifies. */
export function setBonusStat(color: EmblemColor): keyof StatBlock | null {
  switch (color) {
    case "brown":
      return "attack";
    case "green":
      return "spAttack";
    case "blue":
      return "defense";
    case "purple":
      return "spDefense";
    case "white":
      return "hp";
    case "red":
      return "attackSpeed";
    case "yellow":
      return "moveSpeed"; // out-of-combat only (gated in computeEffectiveStats)
    case "black":
      return "cdr";
    // pink (hindrance reduction) has no StatBlock field; handle separately.
    default:
      return null;
  }
}
