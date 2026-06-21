/**
 * Per-Pokémon emblem-optimizer preset lookup + objective adapters.
 *
 * Presets are the community-derived (or hand-curated) search objective for a
 * Pokémon — stat priorities, protect floors and a color shell mined from its
 * UNITE-DB builds, with tier snapping applied at generation time (see
 * tools/meta-defaults/generate-presets.ts). They replace the role-generic
 * the role-generic priorityWeights / deriveProtectFloors / colorTargetsFor
 * derivation when one exists and is confident enough.
 *
 * Fallback chain (highest priority first):
 *   1. Manual override  — pokemon.emblemPreset (curated_builds.json → normalize.py)
 *   2. Auto preset      — emblemOptimizerPresets.json[id], confidence ≥ threshold
 *   3. Generic          — caller falls back when this resolver returns null
 *
 * This module loads the generated JSON the same way the engine loads other data
 * (a static JSON import, zod-validated upstream via the bundle for the manual
 * override). It is pure TypeScript with no React/DOM imports.
 */

import presetsData from "../../data/emblemOptimizerPresets.json";
import type { EmblemColor, EmblemOptimizerPreset, Pokemon, StatBlock } from "../../types";
import { deriveDefenseSoftFloor, deriveMobilityFloor } from "./protectDefaults";
import type { StatFloors, StatWeights } from "./types";

interface PresetsFile {
  _meta: { confidenceThreshold?: number };
  presets: Record<string, EmblemOptimizerPreset>;
}

const FILE = presetsData as unknown as PresetsFile;
const AUTO_PRESETS: Record<string, EmblemOptimizerPreset> = FILE.presets ?? {};

/**
 * Minimum confidence for an auto preset to be used (below this the Pokémon falls
 * back to the generic derivation). Read from the generated file's _meta so the
 * generator and engine stay in lock-step.
 */
export const PRESET_CONFIDENCE_THRESHOLD = FILE._meta?.confidenceThreshold ?? 0.4;

/**
 * Scale factor mapping a preset's 0–1 "importance" priorities to the engine's
 * weight range. Mirrors the Advanced UI's WEIGHT_UI_MAX (slider 1.0 = engine
 * weight 5) so preset priorities and the role-generic priorityWeights (which
 * span ~0–6) land on the same scale the scorer expects.
 */
export const PRESET_PRIORITY_ENGINE_SCALE = 5;

export type PresetSource = "manual" | "auto";

export interface ResolvedEmblemPreset {
  preset: EmblemOptimizerPreset;
  source: PresetSource;
}

/**
 * Resolve the preset to use for a Pokémon, or null when it should fall back to
 * the generic derivation. A manual override (pokemon.emblemPreset) always wins;
 * otherwise the auto preset is used when its confidence meets the threshold.
 */
export function resolveEmblemPreset(
  pokemon: Pokemon,
  threshold: number = PRESET_CONFIDENCE_THRESHOLD,
): ResolvedEmblemPreset | null {
  if (pokemon.emblemPreset) return { preset: pokemon.emblemPreset, source: "manual" };
  const auto = AUTO_PRESETS[pokemon.id];
  if (auto && (auto.confidence ?? 0) >= threshold) return { preset: auto, source: "auto" };
  return null;
}

/** A preset's stat priorities scaled into the engine's weight range. */
export function presetPriorities(preset: EmblemOptimizerPreset): StatWeights {
  const out: StatWeights = {};
  for (const [stat, v] of Object.entries(preset.priorities) as [keyof StatBlock, number][]) {
    if (v) out[stat] = v * PRESET_PRIORITY_ENGINE_SCALE;
  }
  return out;
}

/** A preset's color shell as the Map the search/color resolver expects. */
export function presetColorTargets(preset: EmblemOptimizerPreset): Map<EmblemColor, number> {
  return new Map(
    Object.entries(preset.colorTargets).filter(([, n]) => (n ?? 0) > 0) as [EmblemColor, number][],
  );
}

/**
 * A preset's protect floors merged with the role-based engine guards so the
 * preset never *weakens* them: the mobility floor (move speed 0 for mobile
 * roles, incl. Supporter) and the defense/spDefense soft floor stay intact. The
 * most-protective (max) floor wins per stat, so a community floor stricter than
 * a guard is kept, and a guard stricter than the community floor is restored.
 */
export function presetProtectFloors(pokemon: Pokemon, preset: EmblemOptimizerPreset): StatFloors {
  const out: StatFloors = { ...preset.protectedFloors };
  const guards: StatFloors = {
    ...deriveDefenseSoftFloor(pokemon),
    ...deriveMobilityFloor(pokemon),
  };
  for (const [stat, g] of Object.entries(guards) as [keyof StatBlock, number][]) {
    out[stat] = Math.max(out[stat] ?? Number.NEGATIVE_INFINITY, g);
  }
  return out;
}
