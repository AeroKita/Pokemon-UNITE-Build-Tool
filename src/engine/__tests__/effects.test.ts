import { describe, it, expect } from "vitest";
import { availableActiveBoosts } from "../effects";
import asb from "../../data/attackSpeedBoosts.json";
import { loadBundle } from "../../data/loadBundle";
import raw from "../../data/patch-current.json";

const bundle = loadBundle(raw);
const find = (id: string) => bundle.pokemon.find((p) => p.id === id)!;
const moves = asb.moves as Record<
  string,
  { source: string; asPoints: number; minLevel?: number }[]
>;

describe("attack-speed boost data (audited from the community calculator)", () => {
  it("has a numeric asPoints for every move boost", () => {
    for (const [pk, list] of Object.entries(moves))
      for (const e of list) expect(typeof e.asPoints, `${pk}/${e.source}`).toBe("number");
  });

  it("includes Tsareena (the recovered parser-gap entry)", () => {
    expect(moves["Tsareena"]?.[0]).toMatchObject({ source: "Triple Axel", minLevel: 5 });
  });
});

describe("active-boost resolution", () => {
  it("always offers ally buffs, even for a Pokémon with no move AS buffs", () => {
    const boosts = availableActiveBoosts(find("gardevoir"), [null, null, null], null);
    const ally = boosts.filter((b) => b.source === "ally").map((b) => b.id);
    expect(ally).toContain("blissey-helping-hand");
    expect(ally).toContain("mew-coaching");
    expect(boosts.some((b) => b.source === "move")).toBe(false);
  });

  it("adds the selected Pokémon's move buffs dynamically", () => {
    const boosts = availableActiveBoosts(find("tsareena"), [null, null, null], null);
    expect(boosts.some((b) => b.id === "move:Triple Axel")).toBe(true);
  });
});
