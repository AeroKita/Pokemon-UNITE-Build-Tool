/**
 * Guard: emblemOptimizerPresets.json must match what generate-presets.ts
 * would emit from the current patch-current.json. Run `npm run generate:presets`
 * after normalize when builds change.
 */
import { describe, it, expect } from "vitest";
import { loadBundle } from "../loadBundle";
import rawPatch from "../patch-current.json";
import shippedPresets from "../emblemOptimizerPresets.json";
import { buildPresetsFile } from "../../../tools/meta-defaults/generate-presets";

describe("emblemOptimizerPresets.json sync", () => {
  it("matches patch-current.json builds (run npm run generate:presets if stale)", () => {
    const bundle = loadBundle(rawPatch);
    const expected = buildPresetsFile(
      bundle.pokemon,
      bundle.emblems,
      bundle.setBonuses,
      bundle.patchVersion,
    );

    expect(shippedPresets._meta.patchVersion).toBe(bundle.patchVersion);
    expect(shippedPresets._meta.pokemonWithPresets).toBe(expected._meta.pokemonWithPresets);
    expect(shippedPresets._meta.pokemonFallback).toBe(expected._meta.pokemonFallback);
    expect(shippedPresets.presets).toEqual(expected.presets);
  });
});
