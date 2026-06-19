import { describe, it, expect } from "vitest";
import { loadBundle } from "../loadBundle";
import { computeEmblemLoadout } from "../../engine/emblems";
import { computeEffectiveStats } from "../../engine/formulas";
import type { CalcContext } from "../../types";
import raw from "../patch-current.json";

// Guards the live community bundle (UNITE-DB) against schema drift and bad data.
describe("community data bundle", () => {
  const bundle = loadBundle(raw);

  it("zod-validates and has the full roster", () => {
    expect(bundle.pokemon.length).toBeGreaterThanOrEqual(90);
    expect(bundle.heldItems.length).toBeGreaterThanOrEqual(40);
    expect(bundle.emblems.length).toBeGreaterThanOrEqual(250);
    expect(bundle.setBonuses.length).toBeGreaterThanOrEqual(9);
  });

  it("reproduces Lucario Lv15 in-game base stats", () => {
    const l = bundle.pokemon.find((p) => p.id === "lucario")!;
    const s = l.baseStatsByLevel[14];
    expect(s).toMatchObject({ hp: 7249, attack: 429, defense: 390, spAttack: 115, spDefense: 300 });
    expect(s.critRate).toBe(0.2);
    expect(s.attackSpeed).toBe(0.4);
    expect(s.moveSpeed).toBe(4300);
  });

  it("has exact max-level held-item flats at grade 40", () => {
    const fs = bundle.heldItems.find((i) => i.id === "float-stone")!.statsByGrade["40"];
    expect(fs).toMatchObject({ attack: 28, moveSpeed: 175 });
    const mb = bundle.heldItems.find((i) => i.id === "muscle-band")!.statsByGrade["40"];
    expect(mb.attack).toBe(17.5);
    expect(mb.attackSpeed).toBeCloseTo(0.0875, 6);
  });

  it("every pokemon has 15 level rows and a local asset path", () => {
    for (const p of bundle.pokemon) {
      expect(p.baseStatsByLevel).toHaveLength(15);
      expect(p.imageAsset).toMatch(/^\/assets\//);
    }
  });

  it("applies 6-Brown set bonus then item flats in the right order", () => {
    const lucario = bundle.pokemon.find((p) => p.id === "lucario")!;
    const brown = bundle.emblems
      .filter((e) => e.colors.includes("brown"))
      .slice(0, 6)
      .map((emblem) => ({ emblem, grade: "gold" as const }));
    const loadout = computeEmblemLoadout(brown, bundle.setBonuses);
    expect(loadout.activeSetBonuses.find((b) => b.color === "brown")?.bonusPercent).toBe(0.04);
    const ctx: CalcContext = { inCombat: true, goalsScored: 0 };
    const eff = computeEffectiveStats(lucario, 15, loadout, [], [], ctx);
    // attack must be strictly greater than base 429 after the +4% brown bonus
    expect(eff.attack).toBeGreaterThan(429);
  });

  it("marks UNITE-DB gold-only emblems (no silver/bronze on CDN)", () => {
    const goldOnly = bundle.emblems.filter((e) => e.goldOnly);
    expect(goldOnly.map((e) => e.pokemonName).sort()).toEqual([
      "Floragato",
      "Latias",
      "Latios",
      "Meowscarada",
      "Miraidon",
      "Sprigatito",
    ]);
  });

  it("gives every non-basic move a local skill-icon path", () => {
    for (const p of bundle.pokemon) {
      for (const m of p.moves) {
        if (m.slot === "basicAttack") continue;
        expect(m.iconAsset, `${p.id}/${m.name}`).toMatch(/^\/assets\/skills\//);
      }
    }
  });

  it("carries each curated build's two final moves (resolvable to icons)", () => {
    const lucario = bundle.pokemon.find((p) => p.id === "lucario")!;
    const moveByName = new Map(lucario.moves.map((m) => [m.name, m]));
    const build = lucario.builds!.find((b) => b.name === "Extreme Rush")!;
    expect(build.moves).toEqual(["Extreme Speed", "Bone Rush"]);
    for (const name of build.moves!) {
      expect(moveByName.get(name)?.iconAsset).toMatch(/^\/assets\/skills\//);
    }
  });

  it("every build move name resolves to a move in that Pokémon's catalog", () => {
    for (const p of bundle.pokemon) {
      const names = new Set(p.moves.map((m) => m.name));
      for (const b of p.builds ?? []) {
        for (const mv of b.moves ?? []) {
          expect(names.has(mv), `${p.id}: build "${b.name}" move "${mv}"`).toBe(true);
        }
      }
    }
  });

  it("held items expose grades 1–40 with correct scaling (Muscle Band)", () => {
    const mb = bundle.heldItems.find((i) => i.id === "muscle-band")!;
    expect(Object.keys(mb.statsByGrade)).toHaveLength(40);
    expect(mb.statsByGrade["30"]?.attack).toBe(15);
    expect(mb.statsByGrade["40"]?.attack).toBe(17.5);
    expect(mb.statsByGrade["40"]?.attackSpeed).toBeCloseTo(0.0875, 6);
  });

  it("carries structured grade 1/10/20 effect tiers from the source", () => {
    const mb = bundle.heldItems.find((i) => i.id === "muscle-band")!;
    expect(mb.effect).toEqual({ label: "Remaining HP", tiers: ["1%", "2%", "3%"] });
    const dc = bundle.heldItems.find((i) => i.id === "drain-crown")!;
    expect(dc.effect).toEqual({ label: "Lifesteal", tiers: ["9%", "12%", "15%"] });
  });

  // Curated-merge regression guard: normalize.py must keep hand-curated emblemName labels.
  it("preserves curated build emblemName from curated_builds.json", () => {
    const skeledirge = bundle.pokemon.find((p) => p.id === "skeledirge")!;
    const build = skeledirge.builds!.find((b) => b.name === "Singing Special Attacker")!;
    expect(build.emblemName).toBe("Singing Special Attacker");
  });
});
