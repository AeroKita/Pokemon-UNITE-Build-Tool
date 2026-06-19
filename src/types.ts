// Pokémon UNITE Build Optimizer — Core Data Model
// All game data should live in versioned JSON bundles conforming to these types.

// ----- Core Stat Block -------------------------------------------------------

export interface StatBlock {
  hp: number;
  attack: number;
  defense: number;
  spAttack: number;
  spDefense: number;
  critRate: number; // percentage as decimal, e.g. 0.20 for 20%
  cdr: number; // cooldown reduction %, e.g. 0.10
  lifesteal: number; // %, e.g. 0.05
  spLifesteal: number; // %
  attackSpeed: number; // %, e.g. 0.40 for 40%
  moveSpeed: number; // flat, engine units (~3700 base)
}

// ----- Pokémon ---------------------------------------------------------------

export type Role = "Attacker" | "Speedster" | "AllRounder" | "Defender" | "Supporter";

export type AttackType = "physical" | "special" | "hybrid";

export interface EvolutionStage {
  level: number;
  formName: string;
}

export interface Pokemon {
  id: string; // "lucario"
  displayName: string; // "Lucario"
  role: Role;
  attackType: AttackType;
  difficulty: 1 | 2 | 3;
  imageAsset: string; // path/URL to portrait
  iconAsset: string;
  evolutions: EvolutionStage[]; // level thresholds for evolutions
  baseStatsByLevel: StatBlock[]; // index 0 = level 1 ... index 14 = level 15
  moves: Move[];
  passiveAbility: Ability;
  builds?: PokemonBuild[]; // curated community builds (UNITE-DB) — the "Recommended" tab
  creativeBuilds?: PokemonBuild[]; // optional "Creative" builds (empty until provided by data)
  excludeStats?: string[]; // stats this Pokémon doesn't use (UNITE-DB), e.g. ["attack"]
  hasMegaEvolution?: boolean;
  megaStats?: StatBlock[]; // if applicable (e.g. Mega Lucario)
  // Optional hand-curated emblem-optimizer override (highest-priority preset).
  // Rides in the bundle via tools/community/curated_builds.json → normalize.py.
  // Takes precedence over the auto-generated emblemOptimizerPresets.json entry.
  emblemPreset?: EmblemOptimizerPreset;
}

// A per-Pokémon emblem-optimizer "preset": the auto-derived (or hand-curated)
// search objective for Basic/Advanced mode. Auto presets are generated from the
// Pokémon's community builds by tools/meta-defaults/generate-presets.ts and
// shipped in src/data/emblemOptimizerPresets.json; a manual override may instead
// live on Pokemon.emblemPreset (see curated_builds.json). When present and
// confident enough, it replaces the role-generic priorityWeights /
// deriveProtectFloors / colorTargetsFor derivation in deriveBasicObjective().
export interface EmblemOptimizerPreset {
  // Stat priority weights on a 0–1 "importance" scale (matches the Advanced UI
  // sliders; scaled to the engine's weight range when the objective is built).
  priorities: Partial<Record<keyof StatBlock, number>>;
  // Protect floors: the total flat emblem contribution to a stat must not drop
  // below this value (0 = "don't net-reduce"; negative = a tolerated tax).
  protectedFloors: Partial<Record<keyof StatBlock, number>>;
  // Recommended emblem color shell (color → emblem count) from community builds.
  colorTargets: Partial<Record<EmblemColor, number>>;
  // Confidence 0–1 from community build count + cross-build consistency. Auto
  // presets below the engine threshold fall back to the generic derivation.
  confidence?: number;
  // Number of community builds the preset was derived from.
  buildCount?: number;
  // Provenance: "auto" (generated) or "manual" (curated override).
  source?: "auto" | "manual";
}

// A curated build (from UNITE-DB's per-Pokémon "Builds" tab): held items, a
// battle item, and an exact 10-emblem set with grades.
export interface EmblemBuildPick {
  emblemId: string;
  grade: EmblemGrade;
}

export interface PokemonBuild {
  name: string; // e.g. "Power-Up Rush"
  lane?: string;
  emblemName?: string; // e.g. "Bulk Leaning Standard Physical"
  heldItemIds: string[]; // up to 3
  heldItemOptional?: string;
  battleItemId?: string;
  battleItemOptional?: string;
  emblems: EmblemBuildPick[]; // the exact 10-emblem set
  moves?: string[]; // the build's two final (upgraded) move names
}

// ----- Moves & Abilities (RSB damage model) ----------------------------------

export type MoveSlot = "move1" | "move2" | "uniteMove" | "basicAttack";

export type DamageType = "physical" | "special" | "true";

// RSB system: FLOOR(Ratio * Stat + Slider * (Level - 1) + Base)
export interface DamageInstance {
  ratio: number; // R — multiplier on the scaling stat
  scalingStat: "attack" | "spAttack" | "maxHp" | "none";
  slider: number; // S — damage gained per level
  base: number; // B — flat base damage
  damageType: DamageType;
  isPercentMaxHp?: boolean; // % max-HP damage (bypasses eHP scaling)
}

export type MoveEffectType =
  | "shield"
  | "heal"
  | "lifesteal"
  | "damageReduction"
  | "statBuff"
  | "statDebuff"
  | "cc"
  | "movementBuff";

export interface MoveEffect {
  type: MoveEffectType;
  value?: number;
  durationSeconds?: number;
  scalesWith?: "attack" | "spAttack" | "maxHp" | "level";
}

export interface Move {
  id: string;
  name: string;
  slot: MoveSlot;
  upgradeLevel?: number; // level the move becomes available / upgrades
  description: string;
  cooldownSeconds: number;
  damageInstances: DamageInstance[]; // a move may deal damage multiple times
  effects: MoveEffect[]; // CC, shields, heals, buffs
  tags: string[]; // "dash", "aoe", "lifesteal-source", etc.
  iconAsset?: string; // skills/<Pokemon>/<Move>.png (absent for basic attack)
  moveType?: string; // UNITE-DB move type, e.g. "Dash", "Ranged", "Buff"
  isUpgrade?: boolean; // true for a chosen upgrade move (vs. the base skill)
}

export interface Ability {
  id: string;
  name: string;
  description: string;
  effects: MoveEffect[];
  iconAsset?: string; // skills/<Pokemon>/<Passive>.png
}

// ----- Held Items ------------------------------------------------------------

export type ItemEffectType =
  | "onBasicAttack"
  | "onMove"
  | "onScore"
  | "passive"
  | "outOfCombat"
  | "onHpThreshold";

export interface ItemEffect {
  type: ItemEffectType;
  description: string;
  value?: number; // e.g. Muscle Band % current HP
  isPercentHp?: boolean;
  scalesWith?: "attack" | "spAttack" | "maxHp";
  stacking?: boolean; // e.g. Attack Weight stacks per goal
  stackValue?: number;
  maxStacks?: number;
  appliesInCombat?: boolean; // false for OOC effects (e.g. Float Stone)
}

export interface HeldItem {
  id: string; // "muscle-band"
  displayName: string;
  iconAsset: string;
  description: string;
  // Flat stats per item grade 1–40 (in-game max is 40; G40 is the build value).
  statsByGrade: Record<number, Partial<StatBlock>>;
  conditionalEffects: ItemEffect[];
  /** Grade 1 / 10 / 20 scaling of the item's conditional effect (from UNITE-DB). */
  effect?: { label: string; tiers: [string, string, string] };
}

// ----- Emblems ---------------------------------------------------------------

export type EmblemColor =
  | "brown" // Attack
  | "green" // Sp. Attack
  | "blue" // Defense
  | "purple" // Sp. Defense
  | "white" // HP
  | "red" // Atk Speed
  | "yellow" // Move Speed (OOC)
  | "black" // CDR
  | "pink" // Hindrance reduction
  | "navy" // no set bonus
  | "gray"; // no set bonus

export type EmblemGrade = "bronze" | "silver" | "gold" | "platinum";

export interface Emblem {
  id: string; // "diglett"
  pokemonName: string;
  colors: EmblemColor[]; // 1 or 2 colors
  iconAsset: string;
  /** UNITE-DB only lists gold (A-grade) for some newer Pokémon — hide from silver/bronze UI. */
  goldOnly?: boolean;
  // Platinum uses the same values as gold.
  statsByGrade: {
    bronze: Partial<StatBlock>;
    silver: Partial<StatBlock>;
    gold: Partial<StatBlock>;
  };
}

export interface EmblemSetBonus {
  color: EmblemColor;
  stat: keyof StatBlock;
  // e.g. brown = {2: 0.01, 4: 0.02, 6: 0.04}
  //      red   = {3: 0.02, 5: 0.04, 7: 0.08}
  thresholds: Record<number, number>;
}

export interface EmblemSlot {
  emblem: Emblem;
  grade: EmblemGrade;
}

export interface EmblemLoadout {
  slots: EmblemSlot[]; // max 10
  // Computed at runtime (see engine/emblems.ts):
  activeSetBonuses: { color: EmblemColor; bonusPercent: number }[];
  flatTotals: Partial<StatBlock>;
}

// ----- Battle Items (future / out of scope for v1) ---------------------------

export interface BattleItem {
  id: string;
  displayName: string;
  iconAsset: string;
  description: string;
  effects: ItemEffect[];
}

// ----- Versioned Data Bundle -------------------------------------------------

export interface GameDataBundle {
  patchVersion: string; // "1.2.3.4"
  lastUpdated: string; // ISO date
  pokemon: Pokemon[];
  heldItems: HeldItem[];
  emblems: Emblem[];
  setBonuses: EmblemSetBonus[];
  battleItems?: BattleItem[];
}

// ----- Calculation Context ---------------------------------------------------

export interface CalcContext {
  inCombat: boolean;
  goalsScored: number;
}
