// Rule-based build recommendations. Transparent heuristics (no ML): score held
// items by how well their stats serve the Pokémon's role/attack type, pick
// emblem color targets that hit set-bonus thresholds, and choose a trainer item.
// Everything is derived from the data (item stats), so it adapts as data updates.

import type { Emblem, EmblemColor, EmblemGrade, HeldItem, Pokemon, StatBlock } from "../types";
import profiles from "../data/recommendationProfiles.json";

export interface EmblemPickResult {
  emblemId: string;
  grade: EmblemGrade;
}

// Stats a Pokémon never benefits from on offense — negatives here are "free".
export function unneededStats(pokemon: Pokemon): Set<keyof StatBlock> {
  const declared = (pokemon.excludeStats ?? []).map((s) => s.toLowerCase());
  const set = new Set<keyof StatBlock>();
  if (pokemon.attackType === "physical") {
    set.add("spAttack");
    set.add("spLifesteal");
  }
  if (pokemon.attackType === "special") {
    set.add("attack");
  }
  if (declared.includes("attack")) set.add("attack");
  if (declared.includes("sp. attack") || declared.includes("spattack")) set.add("spAttack");
  return set;
}

// Don't let a single emblem drag a NEEDED flat stat below these (the user's
// "don't go too far negative" guardrail). Unneeded stats are exempt.
const NEG_FLOOR: Partial<Record<keyof StatBlock, number>> = {
  hp: -210,
  attack: -15,
  defense: -16,
  spAttack: -15,
  spDefense: -16,
  moveSpeed: -210,
};

const STAT_VALUE_SCALE: Record<keyof StatBlock, number> = {
  hp: 200,
  attack: 14,
  defense: 14,
  spAttack: 14,
  spDefense: 14,
  critRate: 0.04,
  cdr: 0.08,
  lifesteal: 0.05,
  spLifesteal: 0.05,
  attackSpeed: 0.09,
  moveSpeed: 150,
};

const GOLD_GRADE: EmblemGrade = "gold";

/** Stat block for a grade (platinum mirrors gold; missing grades fall back). */
function statsForGrade(emblem: Emblem, grade: EmblemGrade): Partial<StatBlock> {
  if (grade === "platinum") return emblem.statsByGrade.gold;
  return emblem.statsByGrade[grade] ?? emblem.statsByGrade.gold;
}

/** Best grade the player owns for an emblem, or null if unowned at every grade. */
export function bestOwnedGrade(emblemId: string, owned: Set<string>): EmblemGrade | null {
  for (const g of ["gold", "silver", "bronze"] as const) {
    if (owned.has(`${emblemId}:${g}`)) return g;
  }
  return null;
}

/** Net usefulness of an emblem for a Pokémon: useful positives minus harmful
 *  (needed-stat) negatives; negatives in unneeded stats are free. Scored at the
 *  given grade (defaults to gold). */
export function emblemUsefulness(
  emblem: Emblem,
  weights: Partial<Record<keyof StatBlock, number>>,
  unneeded: Set<keyof StatBlock>,
  grade: EmblemGrade = "gold",
): number {
  const stats = statsForGrade(emblem, grade);
  let score = 0;
  for (const [stat, value] of Object.entries(stats) as [keyof StatBlock, number][]) {
    if (value > 0) score += (weights[stat] ?? 0.2) * (value / STAT_VALUE_SCALE[stat]);
    else if (value < 0 && !unneeded.has(stat)) score += 1.5 * (value / STAT_VALUE_SCALE[stat]); // penalty
  }
  return score;
}

/** Reject emblems that push a needed flat stat past the negative floor. */
function withinFloors(emblem: Emblem, unneeded: Set<keyof StatBlock>): boolean {
  const stats = emblem.statsByGrade.gold;
  for (const [stat, floor] of Object.entries(NEG_FLOOR) as [keyof StatBlock, number][]) {
    const v = stats[stat];
    if (v != null && v < floor && !unneeded.has(stat)) return false;
  }
  return true;
}

/** Color credits of a concrete emblem set (dual-color counts both; one per Pokémon). */
export function colorCountsOf(
  picks: { emblemId: string }[],
  byId: Map<string, Emblem>,
): Map<EmblemColor, number> {
  const seen = new Map<EmblemColor, Set<string>>();
  for (const p of picks) {
    const e = byId.get(p.emblemId);
    if (!e) continue;
    for (const c of e.colors) {
      if (!seen.has(c)) seen.set(c, new Set());
      seen.get(c)!.add(e.pokemonName);
    }
  }
  return new Map([...seen].map(([c, s]) => [c, s.size]));
}

/** Color targets for a Pokémon: from its top curated build if present, else archetype. */
export function colorTargetsFor(
  pokemon: Pokemon,
  byId: Map<string, Emblem>,
): Map<EmblemColor, number> {
  const build = pokemon.builds?.find((b) => b.emblems.length === 10);
  if (build) {
    const counts = colorCountsOf(build.emblems, byId);
    // keep only the meaningful (set-bonus-reaching) colors
    return new Map([...counts].filter(([, n]) => n >= 2));
  }
  const physical = pokemon.attackType !== "special";
  if (pokemon.role === "Defender")
    return new Map(
      [
        ["white", 6],
        ["brown", physical ? 4 : 0],
        ["blue", 2],
      ].filter(([, n]) => (n as number) > 0) as [EmblemColor, number][],
    );
  if (pokemon.role === "Supporter")
    return new Map<EmblemColor, number>([
      ["black", 6],
      ["white", 4],
    ]);
  if (physical)
    return new Map<EmblemColor, number>([
      ["brown", 6],
      ["white", 6],
    ]);
  return new Map<EmblemColor, number>([
    ["green", 6],
    ["black", 6],
  ]);
}

// Small deterministic PRNG so "Reroll" varies but is reproducible per seed.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Greedily assemble 10 distinct-Pokémon emblems that meet the color targets
 * while maximising usefulness and minimising harmful negatives. `seed` varies
 * the result for Reroll/Randomize.
 */
export function solveEmblemSet(
  pokemon: Pokemon,
  emblems: Emblem[],
  opts: {
    weights?: Partial<Record<keyof StatBlock, number>>;
    targets?: Map<EmblemColor, number>;
    owned?: Set<string>;
    seed?: number;
  } = {},
): EmblemPickResult[] {
  const byId = new Map(emblems.map((e) => [e.id, e]));
  const weights = opts.weights ?? priorityWeights(pokemon);
  const unneeded = unneededStats(pokemon);
  const targets = opts.targets ?? colorTargetsFor(pokemon, byId);
  const rng = mulberry32(opts.seed ?? 1);

  const remaining = new Map(targets);
  const candidates = emblems
    .filter((e) => withinFloors(e, unneeded))
    .map((e) => ({ e, use: emblemUsefulness(e, weights, unneeded) }));

  const picks: EmblemPickResult[] = [];
  const usedPokemon = new Set<string>();
  const need = () => [...remaining.values()].reduce((a, b) => a + Math.max(0, b), 0);

  while (picks.length < 10) {
    const targetsLeft = need() > 0;
    let best: { e: Emblem; s: number } | null = null;
    for (const { e, use } of candidates) {
      if (usedPokemon.has(e.pokemonName)) continue;
      const coverage = e.colors.filter((c) => (remaining.get(c) ?? 0) > 0).length;
      const ownedBonus = opts.owned?.has(`${e.id}:${GOLD_GRADE}`) ? 0.5 : 0;
      // While targets remain, prioritise color coverage; then usefulness; small jitter for variety.
      const s = (targetsLeft ? coverage * 10 : 0) + use + ownedBonus + rng() * 0.5;
      if (s > 0 && (!best || s > best.s)) best = { e, s };
    }
    if (!best) break;
    picks.push({ emblemId: best.e.id, grade: GOLD_GRADE });
    usedPokemon.add(best.e.pokemonName);
    for (const c of best.e.colors)
      if (remaining.has(c)) remaining.set(c, (remaining.get(c) ?? 0) - 1);
  }
  return picks;
}

/**
 * Assemble the best emblem set the player can field from emblems they OWN, each
 * at its best owned grade. Returns up to 10 picks (fewer if the inventory is
 * thin) — the "Your Emblems" build that adapts to the user's collection.
 */
export function solveOwnedEmblemSet(
  pokemon: Pokemon,
  emblems: Emblem[],
  owned: Set<string>,
  opts: { seed?: number } = {},
): EmblemPickResult[] {
  const byId = new Map(emblems.map((e) => [e.id, e]));
  const weights = priorityWeights(pokemon);
  const unneeded = unneededStats(pokemon);
  const targets = colorTargetsFor(pokemon, byId);
  const rng = mulberry32(opts.seed ?? 1);

  const ownedList = emblems
    .map((e) => ({ e, grade: bestOwnedGrade(e.id, owned) }))
    .filter((x): x is { e: Emblem; grade: EmblemGrade } => x.grade !== null)
    .filter((x) => withinFloors(x.e, unneeded))
    .map((x) => ({ ...x, use: emblemUsefulness(x.e, weights, unneeded, x.grade) }));

  const remaining = new Map(targets);
  const picks: EmblemPickResult[] = [];
  const usedPokemon = new Set<string>();
  const need = () => [...remaining.values()].reduce((a, b) => a + Math.max(0, b), 0);

  while (picks.length < 10) {
    const targetsLeft = need() > 0;
    let best: { e: Emblem; grade: EmblemGrade; s: number } | null = null;
    for (const { e, grade, use } of ownedList) {
      if (usedPokemon.has(e.pokemonName)) continue;
      const coverage = e.colors.filter((c) => (remaining.get(c) ?? 0) > 0).length;
      const s = (targetsLeft ? coverage * 10 : 0) + use + rng() * 0.5;
      if (!best || s > best.s) best = { e, grade, s };
    }
    if (!best) break;
    picks.push({ emblemId: best.e.id, grade: best.grade });
    usedPokemon.add(best.e.pokemonName);
    for (const c of best.e.colors)
      if (remaining.has(c)) remaining.set(c, (remaining.get(c) ?? 0) - 1);
  }
  return picks;
}

const MAX_EMBLEMS = 10;
// Lift for being a conventional "core" item for the archetype (stat scores ~1-3).
const META_BONUS = 2;

/** Curated core held-item ids for a Pokémon's archetype (attack type + role). */
export function coreItemsFor(pokemon: Pokemon): Set<string> {
  const ids = new Set<string>();
  const addAll = (list: string[]) => list.forEach((id) => ids.add(id));
  if (pokemon.attackType !== "special") addAll(profiles.physicalCore);
  if (pokemon.attackType !== "physical") addAll(profiles.specialCore);
  if (pokemon.role === "Defender") addAll(profiles.bulkCore);
  if (pokemon.role === "Supporter") addAll(profiles.supportCore);
  return ids;
}

// Typical grade-30 magnitude per stat — used to normalise raw values to ~0..1
// so HP (hundreds) doesn't swamp Attack (tens) when scoring.
const SCALE: Record<keyof StatBlock, number> = {
  hp: 240,
  attack: 18,
  defense: 16,
  spAttack: 30,
  spDefense: 16,
  critRate: 0.04,
  cdr: 0.09,
  lifesteal: 0.06,
  spLifesteal: 0.06,
  attackSpeed: 0.105,
  moveSpeed: 175,
};

/** Stat priorities (weights) for a Pokémon, from attack type + role. */
export function priorityWeights(pokemon: Pokemon): Partial<Record<keyof StatBlock, number>> {
  const physical = pokemon.attackType !== "special";
  const special = pokemon.attackType !== "physical";
  const w: Partial<Record<keyof StatBlock, number>> = {};
  const add = (k: keyof StatBlock, v: number) => (w[k] = (w[k] ?? 0) + v);

  if (physical) {
    add("attack", 3);
    add("critRate", 1.5);
    add("attackSpeed", 1.2);
    add("lifesteal", 0.8);
  }
  if (special) {
    add("spAttack", 3);
    add("cdr", 1.5);
    add("spLifesteal", 0.6);
  }

  switch (pokemon.role) {
    case "Attacker":
      add(physical ? "attack" : "spAttack", 1.5);
      add("critRate", physical ? 0.8 : 0);
      break;
    case "AllRounder":
      add("attack", 0.8);
      add("hp", 0.8);
      add("lifesteal", 0.6);
      break;
    case "Speedster":
      add("attack", 1);
      add("critRate", 1);
      add("moveSpeed", 0.6);
      add("lifesteal", 0.6);
      break;
    case "Defender":
      add("hp", 2.5);
      add("defense", 2);
      add("spDefense", 2);
      add("cdr", 1);
      break;
    case "Supporter":
      add("cdr", 2);
      add("hp", 1.5);
      add("spDefense", 1.2);
      break;
  }
  return w;
}

/** Score a held item against a weight map (normalised by stat magnitude). */
export function scoreHeldItem(
  item: HeldItem,
  weights: Partial<Record<keyof StatBlock, number>>,
  coreIds?: Set<string>,
  grade = 30,
): number {
  const stats = item.statsByGrade[grade] ?? {};
  let score = 0;
  for (const [stat, value] of Object.entries(stats) as [keyof StatBlock, number][]) {
    const weight = weights[stat] ?? 0;
    if (weight && value) score += weight * (value / SCALE[stat]);
  }
  // Reward build-defining conditional effects that match an offensive profile.
  const offensive = (weights.attack ?? 0) + (weights.spAttack ?? 0) > 0;
  if (offensive && item.conditionalEffects.some((e) => e.stacking || e.type === "onBasicAttack"))
    score += 0.5;
  // Curated meta bonus: conventional core items for this archetype rank up.
  if (coreIds?.has(item.id)) score += META_BONUS;
  return score;
}

export interface EmblemColorTarget {
  color: EmblemColor;
  count: number;
  stat: keyof StatBlock;
  bonusPercent: number;
}

export interface Recommendation {
  heldItemIds: string[];
  battleItemId: string | null;
  emblemColors: EmblemColorTarget[];
  rationale: string;
}

// Which emblem color boosts each priority stat (matches setBonuses table).
const STAT_COLOR: Partial<Record<keyof StatBlock, EmblemColor>> = {
  attack: "brown",
  spAttack: "green",
  defense: "blue",
  spDefense: "purple",
  hp: "white",
  attackSpeed: "red",
  cdr: "black",
  moveSpeed: "yellow",
};

export function recommendBuild(
  pokemon: Pokemon,
  heldItems: HeldItem[],
  setBonuses: { color: EmblemColor; stat: keyof StatBlock; thresholds: Record<number, number> }[],
): Recommendation {
  const weights = priorityWeights(pokemon);
  const coreIds = coreItemsFor(pokemon);

  // Top 3 held items by score (stat alignment + curated meta bonus).
  const heldItemIds = [...heldItems]
    .map((i) => ({ id: i.id, score: scoreHeldItem(i, weights, coreIds) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.id);

  // Emblem colors: the two highest-weighted stats that have a color + set bonus,
  // aiming for the 6-emblem (or 7 for AS/CDR) primary threshold + a 4/3 secondary.
  const ranked = (Object.entries(weights) as [keyof StatBlock, number][])
    .filter(([stat]) => STAT_COLOR[stat])
    .sort((a, b) => b[1] - a[1]);
  const emblemColors: EmblemColorTarget[] = [];
  let remaining = MAX_EMBLEMS; // total emblems can't exceed 10
  for (const [stat] of ranked.slice(0, 2)) {
    const color = STAT_COLOR[stat]!;
    const def = setBonuses.find((s) => s.color === color);
    if (!def) continue;
    // Largest set-bonus threshold that still fits in the remaining slots.
    const thresholds = Object.keys(def.thresholds)
      .map(Number)
      .sort((a, b) => b - a);
    const fit = thresholds.find((t) => t <= remaining);
    if (fit == null) continue;
    emblemColors.push({ color, count: fit, stat, bonusPercent: def.thresholds[fit] });
    remaining -= fit;
  }

  const battleItemId =
    pokemon.role === "Defender" || pokemon.role === "Supporter" ? "eject-button" : "x-attack";

  const top = ranked[0]?.[0];
  const rationale =
    `${pokemon.displayName} is a ${pokemon.role} (${pokemon.attackType}). Prioritising ` +
    `${top ?? "core"} — items and ${emblemColors.map((e) => `${e.count} ${e.color}`).join(" + ")} emblems align with that.`;

  return { heldItemIds, battleItemId, emblemColors, rationale };
}
