/**
 * Held-item synergy: recommend held items that complement BOTH the Pokémon's kit
 * and the specific emblem set the optimizer found.
 *
 * Scoring blends four refresh-safe signals (see plans/2026-06-18-…):
 *   1. Stat fit + archetype core      — scoreHeldItem() (existing).
 *   2. Community votes                 — items expert builds actually run.
 *   3. Emblem synergy                  — items whose effects scale with the
 *                                        set bonuses present in THIS build
 *                                        (attack-speed → on-hit items, CDR →
 *                                        on-move/Unite items).
 *   4. Kit synergy                     — basic-attacker vs caster vs bulk vs
 *                                        support, from move/ability data.
 *
 * The final three are then chosen as a SET (triplet selection) so they
 * complement rather than duplicate each other (no "three crit items").
 *
 * All inputs derive from the bundle, so recommendations track UNITE-DB refreshes
 * automatically; curated knowledge is limited to the tiny override map in
 * itemTags.ts. See itemTags.ts / kitProfile.ts for the per-signal details.
 */

import type { EmblemSetBonus, EmblemSlot, HeldItem, Pokemon, StatBlock } from "../../types";
import { computeEmblemLoadout } from "../emblems";
import { setBonusStat } from "../formulas";
import {
  coreItemsFor,
  communityItemVotes,
  priorityWeights,
  scoreHeldItem,
  unneededStats,
} from "../recommend";
import { ABILITY_TAGS, BASIC_ATTACK_TAGS, deriveItemTags, type ItemTag } from "../itemTags";
import { deriveKitProfile, type KitProfile } from "../kitProfile";

// ---------------------------------------------------------------------------
// Tuning — sized relative to scoreHeldItem (stat ~1-3, core META_BONUS = +2).
// ---------------------------------------------------------------------------

/** A unanimous community pick (in every build) adds this much — can override core. */
const COMMUNITY_BONUS = 4;
/** Per active emblem axis (attack-speed / CDR) an item's effect synergizes with. */
const EMBLEM_SYNERGY_BONUS = 1.2;
/** Scales kit-fit (kit axis strength 0..1 × matching item tags). */
const KIT_BONUS = 1.5;
/** Penalty per extra item sharing a dominant stat (diminishing returns). */
const DUP_STAT_PENALTY = 0.5;
/** Penalty for redundant duplicate utility (two anti-heals, two scoring stackers). */
const DUP_TAG_PENALTY = 0.75;
/** Reward per distinct payoff tag the triplet covers (complementary set). */
const DIVERSITY_BONUS = 0.15;
/** Penalty when an item's main contribution is a stat the Pokémon can't use. */
const UNNEEDED_PENALTY = 1.5;

// Kit axis → item tags that pay off for that axis.
const KIT_TAGS: Record<keyof KitProfile, ItemTag[]> = {
  basicAttack: ["onBasicAttack", "crit"],
  ability: ["onMove", "onUnite"],
  bulk: ["bulk", "shield"],
  support: ["support", "shield", "sustain"],
  sustain: ["sustain"],
};

// Payoff tags used for triplet diversity + redundancy.
const PAYOFF_TAGS: ItemTag[] = [
  "crit",
  "sustain",
  "shield",
  "support",
  "penetration",
  "antiHeal",
  "burst",
  "bulk",
  "mobility",
];
// Utility tags where running two is usually redundant.
const REDUNDANT_TAGS: ItemTag[] = ["antiHeal", "onScore"];

const DOMINANT_SCALE: Record<keyof StatBlock, number> = {
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HeldItemSuggestion {
  itemId: string;
  displayName: string;
  /** Composite score (higher is better). */
  score: number;
  /** One-line human-readable reason for this pick. */
  reason: string;
  /** Effect tags driving the pick (for UI / explainability). */
  tags: ItemTag[];
}

export interface HeldItemSynergyResult {
  suggestions: HeldItemSuggestion[];
  /** Set-bonus % gains active in the emblem build (stat → decimal). */
  emblemSetBoosts: Partial<Record<keyof StatBlock, number>>;
  /** One-sentence explanation of how emblems/kit shaped item choice. */
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dominantStat(item: HeldItem, grade: number): keyof StatBlock | null {
  const stats = item.statsByGrade[grade] ?? item.statsByGrade[40] ?? {};
  let best: keyof StatBlock | null = null;
  let bestVal = 0;
  for (const [stat, value] of Object.entries(stats) as [keyof StatBlock, number][]) {
    if (!value) continue;
    const norm = value / (DOMINANT_SCALE[stat] ?? 1);
    if (norm > bestVal) {
      bestVal = norm;
      best = stat;
    }
  }
  return best;
}

interface Scored {
  item: HeldItem;
  base: number;
  community: number;
  emblem: number;
  kit: number;
  penalty: number;
  total: number;
  tags: Set<ItemTag>;
  dominant: keyof StatBlock | null;
}

/** Emblem axes (item-relevant) that the found set actually activates. */
function emblemSynergyAxes(
  boosts: Partial<Record<keyof StatBlock, number>>,
): { wantsBasicAttack: boolean; wantsAbility: boolean } {
  return {
    wantsBasicAttack: (boosts.attackSpeed ?? 0) > 0,
    wantsAbility: (boosts.cdr ?? 0) > 0,
  };
}

function strongestKitAxis(kit: KitProfile): keyof KitProfile {
  return (Object.entries(kit) as [keyof KitProfile, number][]).sort((a, b) => b[1] - a[1])[0][0];
}

function reasonFor(s: Scored, kit: KitProfile): string {
  const parts: { label: string; weight: number }[] = [
    { label: "expert builds run it", weight: s.community },
    { label: "synergy with your emblems", weight: s.emblem },
    { label: `fits a ${strongestKitAxis(kit)} kit`, weight: s.kit },
    { label: "strong stats for this role", weight: s.base },
  ];
  parts.sort((a, b) => b.weight - a.weight);
  return parts[0].label[0].toUpperCase() + parts[0].label.slice(1);
}

// ---------------------------------------------------------------------------
// Triplet selection
// ---------------------------------------------------------------------------

function payoffTagsOf(tags: Set<ItemTag>): ItemTag[] {
  return PAYOFF_TAGS.filter((t) => tags.has(t));
}

function tripletScore(combo: Scored[]): number {
  let s = combo.reduce((sum, c) => sum + c.total, 0);

  // Diminishing returns on stacking the same dominant stat.
  const byStat = new Map<keyof StatBlock, number>();
  for (const c of combo) {
    if (!c.dominant) continue;
    byStat.set(c.dominant, (byStat.get(c.dominant) ?? 0) + 1);
  }
  for (const count of byStat.values()) {
    if (count > 1) s -= (count - 1) * DUP_STAT_PENALTY;
  }

  // Redundant duplicate utility (e.g. two anti-heal, two scoring stackers).
  for (const tag of REDUNDANT_TAGS) {
    const n = combo.filter((c) => c.tags.has(tag)).length;
    if (n > 1) s -= (n - 1) * DUP_TAG_PENALTY;
  }

  // Reward complementary coverage of distinct payoff tags.
  const distinct = new Set<ItemTag>();
  for (const c of combo) for (const t of payoffTagsOf(c.tags)) distinct.add(t);
  s += distinct.size * DIVERSITY_BONUS;

  return s;
}

/** Choose the best complementary triplet from the top candidates. */
function chooseTriplet(scored: Scored[]): Scored[] {
  const pool = scored.slice(0, Math.min(8, scored.length));
  if (pool.length <= 3) return pool;

  let best: { combo: Scored[]; score: number } | null = null;
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      for (let k = j + 1; k < pool.length; k++) {
        const combo = [pool[i], pool[j], pool[k]];
        const score = tripletScore(combo);
        if (!best || score > best.score) best = { combo, score };
      }
    }
  }
  return (best?.combo ?? pool.slice(0, 3)).slice().sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Recommend up to 3 held items that synergize with an emblem build + Pokémon.
 *
 * @param pokemon    The selected Pokémon.
 * @param _level     Optimisation level (reserved; weights don't vary with level yet).
 * @param slots      Result emblem slots from the optimizer.
 * @param setBonuses Global set-bonus table from gameData.
 * @param allItems   Full held-item list from gameData.
 * @param itemGrade  Grade to score at (default 30).
 */
export function recommendItemsForEmblemBuild(
  pokemon: Pokemon,
  _level: number,
  slots: EmblemSlot[],
  setBonuses: EmblemSetBonus[],
  allItems: HeldItem[],
  itemGrade = 30,
): HeldItemSynergyResult {
  const emblemLoadout = computeEmblemLoadout(slots, setBonuses);
  const baseWeights = priorityWeights(pokemon);
  const coreIds = coreItemsFor(pokemon);
  const votes = communityItemVotes(pokemon);
  const kit = deriveKitProfile(pokemon);
  const unneeded = unneededStats(pokemon);

  // Per-stat set-bonus boost percentages active in this build.
  const emblemSetBoosts: Partial<Record<keyof StatBlock, number>> = {};
  for (const bonus of emblemLoadout.activeSetBonuses) {
    const stat = setBonusStat(bonus.color);
    if (stat) emblemSetBoosts[stat] = (emblemSetBoosts[stat] ?? 0) + bonus.bonusPercent;
  }
  const { wantsBasicAttack, wantsAbility } = emblemSynergyAxes(emblemSetBoosts);

  // Reduce priority for stats already well-covered by emblem set bonuses so
  // items diversify into gaps (kept light — the synergy bonuses do the heavy work).
  const adjustedWeights: Partial<Record<keyof StatBlock, number>> = { ...baseWeights };
  for (const [stat, boostPct] of Object.entries(emblemSetBoosts) as [keyof StatBlock, number][]) {
    if (adjustedWeights[stat] !== undefined) {
      adjustedWeights[stat] = (adjustedWeights[stat] ?? 0) * Math.max(0.3, 1 - boostPct * 15);
    }
  }

  // Score eligible items (skip unique items with no grade stats — Mega Stones etc).
  const eligible = allItems.filter((item) => Object.keys(item.statsByGrade).length > 0);

  const scored: Scored[] = eligible.map((item) => {
    const tags = deriveItemTags(item);
    const base = scoreHeldItem(item, adjustedWeights, coreIds, itemGrade);

    const community = (votes.get(item.id) ?? 0) * COMMUNITY_BONUS;

    // Emblem synergy: item effects that scale with the set bonuses present.
    let emblem = 0;
    if (wantsBasicAttack && [...tags].some((t) => BASIC_ATTACK_TAGS.has(t))) emblem += EMBLEM_SYNERGY_BONUS;
    if (wantsAbility && [...tags].some((t) => ABILITY_TAGS.has(t))) emblem += EMBLEM_SYNERGY_BONUS;

    // Kit synergy: weight matching tags by how strongly the kit leans that way.
    let kitScore = 0;
    for (const [axis, strength] of Object.entries(kit) as [keyof KitProfile, number][]) {
      if (strength <= 0) continue;
      if (KIT_TAGS[axis].some((t) => tags.has(t))) kitScore += strength * KIT_BONUS;
    }

    // Penalty: item's main contribution is a stat this Pokémon can't use.
    const dom = dominantStat(item, itemGrade);
    let penalty = 0;
    if (dom && unneeded.has(dom)) penalty += UNNEEDED_PENALTY;

    const total = base + community + emblem + kitScore - penalty;
    return { item, base, community, emblem, kit: kitScore, penalty, total, tags, dominant: dom };
  });

  scored.sort((a, b) => b.total - a.total);

  const triplet = chooseTriplet(scored);
  const suggestions: HeldItemSuggestion[] = triplet.map((s) => ({
    itemId: s.item.id,
    displayName: s.item.displayName,
    score: s.total,
    reason: reasonFor(s, kit),
    tags: payoffTagsOf(s.tags),
  }));

  // Human-readable summary.
  const activeBonus = Object.entries(emblemSetBoosts) as [keyof StatBlock, number][];
  const synergyNote = wantsBasicAttack
    ? " Attack-speed emblems favor on-hit items."
    : wantsAbility
      ? " Cooldown emblems favor ability/Unite items."
      : "";
  const reasoning =
    (activeBonus.length > 0
      ? `Emblems provide ${activeBonus
          .map(([s, p]) => `+${(p * 100).toFixed(0)}% ${s}`)
          .join(", ")} — items complete the kit.`
      : `Items chosen by role, kit, and expert builds.`) + synergyNote;

  return { suggestions, emblemSetBoosts, reasoning };
}
