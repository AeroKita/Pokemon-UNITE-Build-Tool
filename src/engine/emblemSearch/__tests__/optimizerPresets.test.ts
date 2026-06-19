/**
 * Tests for the emblem-optimizer preset lookup + fallback chain
 * (optimizerPresets.ts) and its integration into deriveBasicObjective.
 *
 * Covers: resolve order (manual > auto > generic), preset → objective adapters,
 * the protect-floor guard merge (mobility / defense soft floor never weakened),
 * and per-Pokémon regressions vs the generic derivation for a few high-signal
 * Pokémon (Sableye, Lucario, Gardevoir, Cinderace).
 */

import { describe, it, expect } from "vitest";
import { pokemonList, pokemonById, emblems } from "../../../data/gameData";
import {
  resolveEmblemPreset,
  presetPriorities,
  presetColorTargets,
  presetProtectFloors,
  PRESET_CONFIDENCE_THRESHOLD,
  PRESET_PRIORITY_ENGINE_SCALE,
} from "../optimizerPresets";
import { deriveBasicObjective } from "../basicObjective";
import { deriveMobilityFloor } from "../protectDefaults";
import type { EmblemOptimizerPreset, Pokemon } from "../../../types";

// ---------------------------------------------------------------------------
// resolve order
// ---------------------------------------------------------------------------

describe("resolveEmblemPreset — fallback chain", () => {
  it("[OPT-1] resolves a high-signal Pokémon to its auto preset", () => {
    const lucario = pokemonById.get("lucario")!;
    const resolved = resolveEmblemPreset(lucario);
    expect(resolved).not.toBeNull();
    expect(resolved!.source).toBe("auto");
    expect((resolved!.preset.confidence ?? 0)).toBeGreaterThanOrEqual(PRESET_CONFIDENCE_THRESHOLD);
  });

  it("[OPT-2] a manual override wins over the auto preset", () => {
    const lucario = pokemonById.get("lucario")!;
    const manual: EmblemOptimizerPreset = {
      priorities: { attack: 1 },
      protectedFloors: {},
      colorTargets: { brown: 6 },
      source: "manual",
    };
    const withOverride: Pokemon = { ...lucario, emblemPreset: manual };
    const resolved = resolveEmblemPreset(withOverride);
    expect(resolved!.source).toBe("manual");
    expect(resolved!.preset).toBe(manual);
  });

  it("[OPT-3] no preset + no override → null (caller uses generic)", () => {
    const fake: Pokemon = { ...pokemonById.get("lucario")!, id: "__not_a_real_pokemon__", emblemPreset: undefined };
    expect(resolveEmblemPreset(fake)).toBeNull();
  });

  it("[OPT-4] an auto preset below threshold is rejected (raise threshold)", () => {
    const lucario = pokemonById.get("lucario")!;
    expect(resolveEmblemPreset(lucario, 1.01)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// preset → objective adapters
// ---------------------------------------------------------------------------

describe("preset → objective adapters", () => {
  it("[OPT-5] presetPriorities scales 0–1 importance into engine weights", () => {
    const preset: EmblemOptimizerPreset = {
      priorities: { hp: 1, attack: 0.5 },
      protectedFloors: {},
      colorTargets: {},
    };
    const w = presetPriorities(preset);
    expect(w.hp).toBeCloseTo(PRESET_PRIORITY_ENGINE_SCALE);
    expect(w.attack).toBeCloseTo(0.5 * PRESET_PRIORITY_ENGINE_SCALE);
  });

  it("[OPT-6] presetColorTargets drops non-positive counts", () => {
    const preset: EmblemOptimizerPreset = {
      priorities: { hp: 1 },
      protectedFloors: {},
      colorTargets: { brown: 6, white: 0 },
    };
    const targets = presetColorTargets(preset);
    expect(targets.get("brown")).toBe(6);
    expect(targets.has("white")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// guard merge — preset never weakens mobility / defense guards
// ---------------------------------------------------------------------------

describe("presetProtectFloors — guard merge", () => {
  it("[OPT-7] restores the moveSpeed 0 mobility guard if a preset would drop it", () => {
    const sableye = pokemonById.get("sableye")!;
    // Sableye is a Supporter → mobility guard applies.
    expect(deriveMobilityFloor(sableye).moveSpeed).toBe(0);
    const weakened: EmblemOptimizerPreset = {
      priorities: { hp: 1 },
      protectedFloors: { moveSpeed: -50 },
      colorTargets: { brown: 6, white: 6 },
    };
    const floors = presetProtectFloors(sableye, weakened);
    expect(floors.moveSpeed).toBe(0); // guard wins over the weaker preset floor
  });

  it("[OPT-8] keeps a preset floor stricter than the guard", () => {
    const sableye = pokemonById.get("sableye")!;
    const strict: EmblemOptimizerPreset = {
      priorities: { hp: 1 },
      protectedFloors: { hp: 25 },
      colorTargets: { white: 6 },
    };
    const floors = presetProtectFloors(sableye, strict);
    expect(floors.hp).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// deriveBasicObjective integration
// ---------------------------------------------------------------------------

describe("deriveBasicObjective — preset vs generic", () => {
  it("[OPT-9] uses preset priorities/colors when a preset is passed", () => {
    const lucario = pokemonById.get("lucario")!;
    const preset = resolveEmblemPreset(lucario)!.preset;
    const withPreset = deriveBasicObjective(lucario, 15, emblems, pokemonList, preset);
    expect(withPreset.priorities).toEqual(presetPriorities(preset));
    expect(withPreset.colorTargets).toEqual(presetColorTargets(preset));
  });

  it("[OPT-10] falls back to generic role weights when no preset is passed", () => {
    const lucario = pokemonById.get("lucario")!;
    const generic = deriveBasicObjective(lucario, 15, emblems, pokemonList);
    const preset = resolveEmblemPreset(lucario)!.preset;
    // The generic role derivation differs from the community preset.
    expect(generic.priorities).not.toEqual(presetPriorities(preset));
  });
});

// ---------------------------------------------------------------------------
// per-Pokémon regressions
// ---------------------------------------------------------------------------

describe("preset regressions vs generic", () => {
  const cases = ["sableye", "lucario", "gardevoir", "cinderace"] as const;

  for (const id of cases) {
    it(`[OPT-REG] ${id}: preset preserves the moveSpeed mobility guard (≥ 0)`, () => {
      const pokemon = pokemonById.get(id)!;
      const resolved = resolveEmblemPreset(pokemon);
      expect(resolved).not.toBeNull();
      const objective = deriveBasicObjective(pokemon, 15, emblems, pokemonList, resolved!.preset);
      // Mobile/Supporter roles must never net-lose move speed under the preset.
      if (deriveMobilityFloor(pokemon).moveSpeed === 0) {
        expect(objective.protectedFloors.moveSpeed).toBeGreaterThanOrEqual(0);
      }
    });
  }

  it("[OPT-REG-HP] Gardevoir (special attacker) prioritizes Sp.Atk, not HP-only", () => {
    const gardevoir = pokemonById.get("gardevoir")!;
    const preset = resolveEmblemPreset(gardevoir)!.preset;
    // Set-bonus intent must surface Sp.Atk as a meaningful priority despite the
    // HP-heavy flat emblem shell (the bug the generator's set-bonus term fixes).
    expect((preset.priorities.spAttack ?? 0)).toBeGreaterThan(0);
  });

  it("[OPT-REG-COVER] the high-signal sample all have presets", () => {
    for (const id of cases) {
      expect(resolveEmblemPreset(pokemonById.get(id)!)).not.toBeNull();
    }
  });

  it("[OPT-REG] Skeledirge: mobility + standard Recommended builds → auto preset", () => {
    const skeledirge = pokemonById.get("skeledirge")!;
    const resolved = resolveEmblemPreset(skeledirge);
    expect(resolved).not.toBeNull();
    expect(resolved!.source).toBe("auto");
    expect((resolved!.preset.priorities.spAttack ?? 0)).toBeGreaterThan(0);
  });
});
