/**
 * Pokémon kit profile — derived from the bundle's own move/ability data so it
 * refreshes automatically with UNITE-DB (no curated playstyle file to maintain).
 *
 * The optimizer's held-item synergy uses two synergy sources:
 *   1. The ACTUAL emblem set bonuses found (attack-speed vs CDR vs bulk) — the
 *      "synergy with the optimized emblems" signal.
 *   2. This kit profile — so a basic-attack carry favors on-hit/crit items and a
 *      caster favors on-move/Unite items even before emblems are considered.
 *
 * Everything here reads `pokemon.passiveAbility`, `pokemon.moves`, role, and
 * attack type — all regenerated on every data pull.
 */

import type { Pokemon } from "../types";

export interface KitProfile {
  /** Relies on basic (auto) attacks — wants attack-speed, crit, on-hit procs. */
  basicAttack: number;
  /** Ability/caster damage — wants CDR and on-move / Unite procs. */
  ability: number;
  /** Frontline durability — wants HP/Def/Sp.Def and shields. */
  bulk: number;
  /** Buffs/heals/shields allies — wants support items. */
  support: number;
  /** Self-sustain (healing / lifesteal in the kit). */
  sustain: number;
}

const BASIC_ATTACK_KEYWORDS = [
  "boosted attack",
  "basic attack",
  "auto attack",
  "auto-attack",
  "critical-hit",
  "critical hit",
];

/** Clamp to [0, 1]. */
const unit = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Derive a normalized kit profile for a Pokémon. Pure + deterministic.
 */
export function deriveKitProfile(pokemon: Pokemon): KitProfile {
  const passive = (pokemon.passiveAbility?.description ?? "").toLowerCase();
  const moves = pokemon.moves ?? [];

  // --- basic-attack reliance ---
  let basicAttack = 0;
  if (BASIC_ATTACK_KEYWORDS.some((k) => passive.includes(k))) basicAttack += 0.6;
  if (pokemon.attackType !== "special") basicAttack += 0.2;
  if (pokemon.role === "Attacker" || pokemon.role === "Speedster") basicAttack += 0.2;
  // Moves that explicitly empower basic attacks.
  if (
    moves.some((m) => {
      const t = `${m.description} ${(m.tags ?? []).join(" ")}`.toLowerCase();
      return t.includes("basic attack") || t.includes("boosted attack") || t.includes("auto attack");
    })
  )
    basicAttack += 0.3;

  // --- ability / caster reliance ---
  let ability = 0;
  if (pokemon.attackType === "special") ability += 0.4;
  // Count move damage instances that scale off an offensive stat.
  const offensiveMoveHits = moves.reduce(
    (n, m) =>
      n +
      (m.damageInstances ?? []).filter(
        (d) => d.scalingStat === "attack" || d.scalingStat === "spAttack",
      ).length,
    0,
  );
  if (offensiveMoveHits >= 4) ability += 0.4;
  else if (offensiveMoveHits >= 2) ability += 0.25;
  if (pokemon.role === "Attacker") ability += 0.2;

  // --- bulk ---
  let bulk = 0;
  if (pokemon.role === "Defender") bulk += 0.7;
  else if (pokemon.role === "AllRounder") bulk += 0.45;
  else if (pokemon.role === "Supporter") bulk += 0.3;
  if (
    moves.some((m) => (m.damageInstances ?? []).some((d) => d.scalingStat === "maxHp"))
  )
    bulk += 0.3;

  // --- support ---
  let support = 0;
  if (pokemon.role === "Supporter") support += 0.6;
  const allyEffects = moves.reduce(
    (n, m) =>
      n +
      (m.effects ?? []).filter(
        (e) => e.type === "shield" || e.type === "heal" || e.type === "movementBuff" || e.type === "statBuff",
      ).length,
    0,
  );
  if (allyEffects >= 3) support += 0.4;
  else if (allyEffects >= 1) support += 0.2;
  const passiveSupport = (pokemon.passiveAbility?.effects ?? []).some(
    (e) => e.type === "shield" || e.type === "heal",
  );
  if (passiveSupport) support += 0.2;

  // --- sustain ---
  let sustain = 0;
  const healOrLeech = moves.some(
    (m) =>
      (m.effects ?? []).some((e) => e.type === "heal" || e.type === "lifesteal") ||
      (m.tags ?? []).some((t) => t.toLowerCase().includes("lifesteal") || t.toLowerCase().includes("recovery")),
  );
  if (healOrLeech) sustain += 0.5;
  if (pokemon.role === "Supporter" || pokemon.role === "AllRounder") sustain += 0.2;

  return {
    basicAttack: unit(basicAttack),
    ability: unit(ability),
    bulk: unit(bulk),
    support: unit(support),
    sustain: unit(sustain),
  };
}
