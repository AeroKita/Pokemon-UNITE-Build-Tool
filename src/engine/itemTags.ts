/**
 * Held-item effect tags — derived automatically from the bundle's own text.
 *
 * Held items get most of their value from conditional effects (procs, stacking,
 * sustain) that are NOT in `statsByGrade`, so flat-stat scoring alone mis-ranks
 * them. Rather than hand-maintaining a tag list (which would silently rot when
 * UNITE-DB data is refreshed), we derive tags from each item's `description` and
 * `effect.label` — the same fields already shipped in `patch-current.json`.
 *
 * Refresh behavior: because this reads the live bundle text, tags update for
 * free on every data pull. UNITE-DB phrasing is templated, and the keywords we
 * match are core mechanic terms ("auto attack", "Unite Move", "shield", …) that
 * are stable across rewrites. The snapshot test (`itemTags.test.ts`) surfaces any
 * tag change in a patch diff for a human glance, and ITEM_TAG_OVERRIDES is the
 * escape hatch for the rare item whose prose is genuinely misleading.
 */

import type { HeldItem } from "../types";

/**
 * Trigger tags = what the item keys off (used for emblem/kit synergy).
 * Payoff tags = what the item provides (used for role fit + triplet diversity).
 */
export type ItemTag =
  // --- triggers ---
  | "onBasicAttack" // procs/scales with basic (auto) attacks → attack-speed synergy
  | "onMove" // procs on ability use → CDR synergy
  | "onUnite" // procs on Unite Move → CDR synergy
  | "onScore" // procs on scoring a goal
  | "onTakedown" // procs on assist / KO
  | "onHpThreshold" // procs at low HP
  | "onDamageTaken" // procs when hit / hindered
  | "outOfCombat" // procs while out of combat
  // --- payoffs ---
  | "stacking" // grows over the match (permanent or refreshing stacks)
  | "crit" // critical-hit payoff
  | "sustain" // HP recovery / lifesteal
  | "shield" // grants a shield
  | "support" // benefits allies
  | "mobility" // movement speed
  | "bulk" // defensive payoff (Def / Sp. Def / max-HP)
  | "penetration" // ignores enemy Def / Sp. Def
  | "antiHeal" // weakens enemy healing
  | "burst"; // extra on-hit / on-move damage

/**
 * Overrides for items whose prose is misleading or whose key interaction is not
 * stated literally. Kept intentionally tiny — prefer fixing the keyword rules.
 * `add` forces tags on; `remove` strips false positives.
 */
const ITEM_TAG_OVERRIDES: Record<string, { add?: ItemTag[]; remove?: ItemTag[] }> = {
  // "certain Unite Moves have unique interactions" — the headline is the Unite proc.
  "energy-amplifier": { add: ["onUnite", "burst"] },
};

/** Item ids that have a curated tag override (validated against the bundle in tests). */
export const ITEM_TAG_OVERRIDE_IDS: readonly string[] = Object.keys(ITEM_TAG_OVERRIDES);

interface Rule {
  tag: ItemTag;
  /** Any of these substrings (lowercased) present → tag applies. */
  any: string[];
  /** None of these may be present (guards against false positives). */
  not?: string[];
}

// Order does not matter; all matching rules apply. Keep patterns anchored to
// durable mechanic vocabulary, not flavor text.
const RULES: Rule[] = [
  { tag: "onBasicAttack", any: ["auto attack", "auto-attack", "basic attack"] },
  // "with a move" / "using a move" / "after using a move" — but NOT "movement".
  { tag: "onMove", any: ["with a move", "using a move", "use a move", "using their move", "after using"] },
  { tag: "onUnite", any: ["unite move"] },
  { tag: "onScore", any: ["scoring a goal", "score a goal", "attempting to score"] },
  { tag: "onTakedown", any: ["assist", "knocking out", "knock out", "knocks out"] },
  { tag: "onHpThreshold", any: ["below 25% hp", "missing hp", "% hp:", "remaining hp"] },
  { tag: "onDamageTaken", any: ["upon receiving damage", "receiving damage", "when a hindrance is inflicted on the pokémon", "upon receiving"] },
  { tag: "outOfCombat", any: ["not in combat", "out of combat"] },

  { tag: "stacking", any: ["stack", "until the end of battle"] },
  { tag: "crit", any: ["critical hit", "critical-hit"] },
  {
    tag: "sustain",
    any: [
      "restore hp",
      "restores hp",
      "recover hp",
      "recovers hp",
      "recovers",
      "recovery",
      "missing hp",
      "restored by",
      "% max hp every",
    ],
    // Anti-heal items ("weakens their HP recovery effect") must not read as sustain.
    not: ["weakens their hp recovery", "weaken"],
  },
  { tag: "shield", any: ["shield"] },
  { tag: "support", any: ["ally", "allies", "ally pokémon"] },
  { tag: "mobility", any: ["movement speed"] },
  { tag: "penetration", any: ["ignores", "ignore", "partially ignore"] },
  { tag: "antiHeal", any: ["weakens their hp recovery", "weaken", "hp recovery effect by"] },
  { tag: "burst", any: ["additional damage", "additional hit", "deals damage to nearby", "as additional"] },
];

/** Lowercased text we scan for keywords. */
function itemText(item: HeldItem): string {
  const label = item.effect?.label ? ` ${item.effect.label}` : "";
  return `${item.description ?? ""}${label}`.toLowerCase();
}

/**
 * Derive the effect tags for a held item from its bundle text.
 * Pure + deterministic; safe to memoize per bundle.
 */
export function deriveItemTags(item: HeldItem): Set<ItemTag> {
  const text = itemText(item);
  const tags = new Set<ItemTag>();

  for (const rule of RULES) {
    if (rule.not?.some((n) => text.includes(n))) continue;
    if (rule.any.some((k) => text.includes(k))) tags.add(rule.tag);
  }

  // Bulk is better inferred from defensive stats than from prose.
  const g = item.statsByGrade[30] ?? item.statsByGrade[40] ?? {};
  if ((g.defense ?? 0) > 0 || (g.spDefense ?? 0) > 0 || (g.hp ?? 0) >= 200) tags.add("bulk");

  const override = ITEM_TAG_OVERRIDES[item.id];
  if (override) {
    override.add?.forEach((t) => tags.add(t));
    override.remove?.forEach((t) => tags.delete(t));
  }

  return tags;
}

/** Tags that benefit from frequent basic attacks (attack-speed / red emblems). */
export const BASIC_ATTACK_TAGS: ReadonlySet<ItemTag> = new Set<ItemTag>([
  "onBasicAttack",
  "crit",
]);

/** Tags that benefit from frequent ability/Unite casts (CDR / black emblems). */
export const ABILITY_TAGS: ReadonlySet<ItemTag> = new Set<ItemTag>([
  "onMove",
  "onUnite",
]);
