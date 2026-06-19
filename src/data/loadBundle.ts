// Bundle loading + validation. A malformed bundle must fail LOUDLY
// (docs/04-data-sourcing.md) — zod throws with a precise path on any
// schema violation.

import { z } from "zod";
import type { GameDataBundle } from "../types";

// Shape-only validation: emblem flats are legitimately negative (stat
// trade-offs), so no range clamps here — loud failure is for STRUCTURE.
const statBlock = z.object({
  hp: z.number(),
  attack: z.number(),
  defense: z.number(),
  spAttack: z.number(),
  spDefense: z.number(),
  critRate: z.number(),
  cdr: z.number(),
  lifesteal: z.number(),
  spLifesteal: z.number(),
  attackSpeed: z.number(),
  moveSpeed: z.number(),
});

const partialStatBlock = statBlock.partial();

const moveEffect = z.object({
  type: z.enum([
    "shield",
    "heal",
    "lifesteal",
    "damageReduction",
    "statBuff",
    "statDebuff",
    "cc",
    "movementBuff",
  ]),
  value: z.number().optional(),
  durationSeconds: z.number().optional(),
  scalesWith: z.enum(["attack", "spAttack", "maxHp", "level"]).optional(),
});

const damageInstance = z.object({
  ratio: z.number(),
  scalingStat: z.enum(["attack", "spAttack", "maxHp", "none"]),
  slider: z.number(),
  base: z.number(),
  damageType: z.enum(["physical", "special", "true"]),
  isPercentMaxHp: z.boolean().optional(),
});

const move = z.object({
  id: z.string(),
  name: z.string(),
  slot: z.enum(["move1", "move2", "uniteMove", "basicAttack"]),
  upgradeLevel: z.number().optional(),
  description: z.string(),
  cooldownSeconds: z.number(),
  damageInstances: z.array(damageInstance),
  effects: z.array(moveEffect),
  tags: z.array(z.string()),
  iconAsset: z.string().optional(),
  moveType: z.string().optional(),
  isUpgrade: z.boolean().optional(),
});

const ability = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  effects: z.array(moveEffect),
  iconAsset: z.string().optional(),
});

const emblemGrade = z.enum(["bronze", "silver", "gold", "platinum"]);

const pokemonBuild = z.object({
  name: z.string(),
  lane: z.string().optional(),
  emblemName: z.string().optional(),
  heldItemIds: z.array(z.string()),
  heldItemOptional: z.string().optional(),
  battleItemId: z.string().optional(),
  battleItemOptional: z.string().optional(),
  emblems: z.array(z.object({ emblemId: z.string(), grade: emblemGrade })),
  moves: z.array(z.string()).optional(),
});

const emblemOptimizerPreset = z.object({
  priorities: partialStatBlock,
  protectedFloors: partialStatBlock,
  // Color keys validated loosely (z.record) — the EmblemColor enum is defined
  // further below; keeping this a string-keyed record avoids a forward ref.
  colorTargets: z.record(z.string(), z.number()),
  confidence: z.number().optional(),
  buildCount: z.number().optional(),
  source: z.enum(["auto", "manual"]).optional(),
});

const pokemon = z.object({
  id: z.string(),
  displayName: z.string(),
  role: z.enum(["Attacker", "Speedster", "AllRounder", "Defender", "Supporter"]),
  attackType: z.enum(["physical", "special", "hybrid"]),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  imageAsset: z.string(),
  iconAsset: z.string(),
  evolutions: z.array(z.object({ level: z.number(), formName: z.string() })),
  baseStatsByLevel: z.array(statBlock).length(15),
  moves: z.array(move),
  passiveAbility: ability,
  builds: z.array(pokemonBuild).optional(),
  creativeBuilds: z.array(pokemonBuild).optional(),
  excludeStats: z.array(z.string()).optional(),
  hasMegaEvolution: z.boolean().optional(),
  megaStats: z.array(statBlock).optional(),
  emblemPreset: emblemOptimizerPreset.optional(),
});

const itemEffect = z.object({
  type: z.enum(["onBasicAttack", "onMove", "onScore", "passive", "outOfCombat", "onHpThreshold"]),
  description: z.string(),
  value: z.number().optional(),
  isPercentHp: z.boolean().optional(),
  scalesWith: z.enum(["attack", "spAttack", "maxHp"]).optional(),
  stacking: z.boolean().optional(),
  stackValue: z.number().optional(),
  maxStacks: z.number().optional(),
  appliesInCombat: z.boolean().optional(),
});

const heldItem = z.object({
  id: z.string(),
  displayName: z.string(),
  iconAsset: z.string(),
  description: z.string(),
  statsByGrade: z.record(z.string(), partialStatBlock),
  conditionalEffects: z.array(itemEffect),
  effect: z
    .object({
      label: z.string(),
      tiers: z.tuple([z.string(), z.string(), z.string()]),
    })
    .optional(),
});

const emblemColor = z.enum([
  "brown",
  "green",
  "blue",
  "purple",
  "white",
  "red",
  "yellow",
  "black",
  "pink",
  "navy",
  "gray",
]);

const emblem = z.object({
  id: z.string(),
  pokemonName: z.string(),
  colors: z.array(emblemColor).min(1).max(2),
  iconAsset: z.string(),
  goldOnly: z.boolean().optional(),
  statsByGrade: z.object({
    bronze: partialStatBlock,
    silver: partialStatBlock,
    gold: partialStatBlock,
  }),
});

const setBonus = z.object({
  color: emblemColor,
  stat: statBlock.keyof(),
  thresholds: z.record(z.string(), z.number()),
});

const battleItem = z.object({
  id: z.string(),
  displayName: z.string(),
  iconAsset: z.string(),
  description: z.string(),
  effects: z.array(itemEffect),
});

export const gameDataBundleSchema = z.object({
  patchVersion: z.string(),
  lastUpdated: z.string(),
  pokemon: z.array(pokemon).min(1),
  heldItems: z.array(heldItem),
  emblems: z.array(emblem),
  setBonuses: z.array(setBonus),
  battleItems: z.array(battleItem).optional(),
});

/**
 * Validate raw JSON into a typed GameDataBundle. Throws ZodError (with the
 * offending path) on any malformed data. The cast is sound because the zod
 * schema above mirrors types.ts; statsByGrade's numeric keys arrive as JSON
 * strings, which JS object indexing treats identically.
 */
export function loadBundle(raw: unknown): GameDataBundle {
  const parsed = gameDataBundleSchema.parse(raw);
  return parsed as unknown as GameDataBundle;
}
