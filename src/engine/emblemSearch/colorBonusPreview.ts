/**
 * Proposed color set-bonus preview.
 *
 * Given a map of per-color emblem counts and the game's EmblemSetBonus table,
 * computes which bonus tiers would be achieved and at what percent. Used to
 * give the user a live preview of the bonuses their color target would unlock.
 *
 * Mirrors the bonus-preview logic in updateColorTargetSummary / colorBonusScore
 * in uniteemblemfinder.github.io/src/app.js (clean-room TypeScript port; no code
 * copied verbatim).
 */

import type { EmblemColor, EmblemSetBonus, StatBlock } from "../../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ColorBonusPreviewItem {
  color: EmblemColor;
  /** The entered count for this color. */
  count: number;
  /** Which stat the bonus applies to. */
  stat: keyof StatBlock;
  /**
   * Bonus fraction, e.g. 0.04 for a 4% bonus.
   * For PERCENT_POINT_STATS (cdr, attackSpeed) this is an additive delta on the
   * percent-domain value; for all other stats it is a multiplier applied to
   * (base + flat emblems).
   */
  percent: number;
  /** 1-based tier number (tier 1 = lowest threshold, tier 3 = highest). */
  tier: number;
  /**
   * True when the bonus is a percentage-point addition (cdr, attackSpeed) rather
   * than a multiplicative % of base. Affects how the concrete delta is displayed.
   */
  percentPoint: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Stats that receive percentage-point additive bonuses (not base-multiplied).
 * Mirrors PERCENT_POINT_STATS in formulas.ts — kept local to avoid coupling.
 */
const PERCENT_POINT_STATS: ReadonlySet<keyof StatBlock> = new Set([
  "attackSpeed",
  "cdr",
] as const);

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Compute which color set-bonus tiers would be achieved given per-color counts.
 *
 * - Only colors with at least one positive bonus threshold are returned.
 * - Colors with only negative bonuses (e.g. pink → −HP) are filtered out.
 * - Mirrors `colorBonusScore(counts, true).details` from uniteemblemfinder.
 *
 * The input `colorCounts` uses ALL active colors (checked in the UI), not only
 * the colors with hard constraints. This matches the reference's "preview" which
 * is shown regardless of the exact/weighted toggle.
 */
export function proposedColorBonuses(
  colorCounts: Map<EmblemColor, number>,
  setBonuses: EmblemSetBonus[],
): ColorBonusPreviewItem[] {
  const result: ColorBonusPreviewItem[] = [];

  for (const def of setBonuses) {
    const count = colorCounts.get(def.color) ?? 0;
    if (count === 0) continue;

    // Find the highest threshold met (thresholds are stored as Record<number, number>)
    const thresholds = Object.keys(def.thresholds)
      .map(Number)
      .sort((a, b) => a - b); // ascending

    let tierIdx = -1;
    for (let i = thresholds.length - 1; i >= 0; i--) {
      if (count >= thresholds[i]) {
        tierIdx = i;
        break;
      }
    }
    if (tierIdx < 0) continue;

    const percent = def.thresholds[thresholds[tierIdx]];
    if (percent <= 0) continue; // skip negative-bonus colors (e.g. pink → −HP)

    result.push({
      color: def.color,
      count,
      stat: def.stat,
      percent,
      tier: tierIdx + 1, // 1-based, matching uniteemblemfinder's tier display
      percentPoint: PERCENT_POINT_STATS.has(def.stat),
    });
  }

  return result;
}

/**
 * Estimate the concrete stat delta the bonus would yield for a Pokémon.
 *
 * - Percent-point stats (cdr, attackSpeed): delta = percent (already in
 *   the correct decimal unit, e.g. 0.04 means +4% CDR).
 * - Multiplied stats: delta ≈ baseStat × percent (using base stat only as
 *   an approximation; actual in-game value includes emblem flats too).
 */
export function concreteBonusDelta(
  item: ColorBonusPreviewItem,
  baseStat: number,
): number {
  if (item.percentPoint) return item.percent;
  return baseStat * item.percent;
}

/**
 * Format the bonus percent for display (e.g. "+4% Attack").
 * Uses brief stat labels suitable for compact badge display.
 */
export const BONUS_STAT_LABELS: Partial<Record<keyof StatBlock, string>> = {
  hp: "HP",
  attack: "Atk",
  defense: "Def",
  spAttack: "Sp. Atk",
  spDefense: "Sp. Def",
  attackSpeed: "Atk Spd",
  cdr: "CDR",
  moveSpeed: "Move Spd",
  critRate: "Crit",
  lifesteal: "Lifesteal",
  spLifesteal: "Sp. Lifesteal",
};
