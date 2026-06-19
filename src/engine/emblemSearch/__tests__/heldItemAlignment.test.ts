/**
 * Real-Pokémon regression: the optimizer's held-item suggestions should align
 * with curated community builds. This is the guard the plan called out as missing
 * (only synthetic stat items were tested before) and the safety net for the
 * auto-derived tag / kit / community signals across UNITE-DB data refreshes.
 */

import { describe, it, expect } from "vitest";
import {
  pokemonList,
  heldItems,
  setBonuses,
  emblemById,
} from "../../../data/gameData";
import { recommendItemsForEmblemBuild } from "../heldItemSynergy";
import { communityItemVotes } from "../../recommend";
import { deriveKitProfile } from "../../kitProfile";
import type { EmblemSlot, Pokemon } from "../../../types";

/** Build emblem slots from a Pokémon's first complete (10-emblem) community build. */
function slotsFromBuild(pokemon: Pokemon): EmblemSlot[] | null {
  const build = pokemon.builds?.find((b) => b.emblems?.length === 10);
  if (!build) return null;
  const slots: EmblemSlot[] = [];
  for (const pick of build.emblems) {
    const emblem = emblemById.get(pick.emblemId);
    if (!emblem) return null;
    slots.push({ emblem, grade: pick.grade });
  }
  return slots;
}

/** Union of all held items used across a Pokémon's curated builds. */
function communityItemSet(pokemon: Pokemon): Set<string> {
  const ids = new Set<string>();
  for (const b of pokemon.builds ?? []) {
    for (const id of b.heldItemIds ?? []) ids.add(id);
    if (b.heldItemOptional) ids.add(b.heldItemOptional);
  }
  return ids;
}

describe("recommendItemsForEmblemBuild — alignment with community builds", () => {
  const withBuilds = pokemonList.filter(
    (p) => slotsFromBuild(p) && (p.builds?.some((b) => (b.heldItemIds?.length ?? 0) >= 3) ?? false),
  );

  it("has a meaningful sample of Pokémon with curated builds", () => {
    expect(withBuilds.length).toBeGreaterThan(10);
  });

  it("recommends mostly community-attested items per Pokémon", () => {
    let totalOverlap = 0;
    let count = 0;
    const weak: string[] = [];

    for (const pokemon of withBuilds) {
      const slots = slotsFromBuild(pokemon)!;
      const result = recommendItemsForEmblemBuild(pokemon, 15, slots, setBonuses, heldItems, 30);
      const community = communityItemSet(pokemon);
      const overlap = result.suggestions.filter((s) => community.has(s.itemId)).length;
      totalOverlap += overlap;
      count += 1;
      if (overlap < 2) weak.push(`${pokemon.displayName} (${overlap})`);
    }

    const avg = totalOverlap / count;
    // Community votes are a strong signal, so on average ≥2 of 3 picks should be
    // items expert builds actually run for that Pokémon.
    expect(avg).toBeGreaterThanOrEqual(2);
    // Allow a few outliers (thin build data) but not a majority.
    expect(weak.length).toBeLessThan(count / 3);
  });

  it("returns three distinct items", () => {
    for (const pokemon of withBuilds.slice(0, 20)) {
      const slots = slotsFromBuild(pokemon)!;
      const result = recommendItemsForEmblemBuild(pokemon, 15, slots, setBonuses, heldItems, 30);
      const ids = result.suggestions.map((s) => s.itemId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("recommendItemsForEmblemBuild — emblem synergy direction", () => {
  // Real red (attack-speed) emblems → trigger the red set bonus.
  function redSlots(): EmblemSlot[] {
    const reds: EmblemSlot[] = [];
    const seen = new Set<string>();
    for (const e of emblemById.values()) {
      if (!e.colors.includes("red")) continue;
      if (seen.has(e.pokemonName)) continue;
      seen.add(e.pokemonName);
      reds.push({ emblem: e, grade: "gold" });
      if (reds.length >= 7) break;
    }
    return reds;
  }

  it("activates the attack-speed axis and favors on-hit items", () => {
    const carry = pokemonList.find((p) => p.attackType === "physical" && p.role === "Attacker");
    const slots = redSlots();
    if (!carry || slots.length < 5) return; // data-dependent; skip if unavailable

    const result = recommendItemsForEmblemBuild(carry, 15, slots, setBonuses, heldItems, 30);
    expect(result.emblemSetBoosts.attackSpeed ?? 0).toBeGreaterThan(0);
    expect(result.reasoning.toLowerCase()).toContain("on-hit");
  });
});

describe("communityItemVotes", () => {
  it("returns normalized votes (0..1) for a Pokémon with builds", () => {
    const mon = pokemonList.find((p) => (p.builds?.length ?? 0) > 0)!;
    const votes = communityItemVotes(mon);
    expect(votes.size).toBeGreaterThan(0);
    for (const v of votes.values()) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("returns an empty map when a Pokémon has no builds", () => {
    const fake = { builds: undefined, creativeBuilds: undefined } as unknown as Pokemon;
    expect(communityItemVotes(fake).size).toBe(0);
  });
});

describe("deriveKitProfile", () => {
  it("flags basic-attack carries vs casters", () => {
    const absol = pokemonList.find((p) => p.id === "absol");
    if (absol) {
      const kit = deriveKitProfile(absol);
      expect(kit.basicAttack).toBeGreaterThan(0);
    }
    const special = pokemonList.find((p) => p.attackType === "special" && p.role === "Attacker");
    if (special) {
      const kit = deriveKitProfile(special);
      expect(kit.ability).toBeGreaterThan(0);
    }
  });

  it("flags supporters as support kits", () => {
    const support = pokemonList.find((p) => p.role === "Supporter");
    if (support) {
      const kit = deriveKitProfile(support);
      expect(kit.support).toBeGreaterThan(0);
    }
  });
});
