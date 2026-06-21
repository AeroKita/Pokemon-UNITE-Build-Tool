import { describe, it, expect } from "vitest";
import { emblems, emblemById, setBonuses, pokemonById } from "../../../data/gameData";
import { buildCandidatePool } from "../adapt";
import { candidatesToEmblemSlots } from "../pokemonScore";
import { deriveEmblemLoadoutImpact, picksToEmblemSlots } from "../pokemonScore";
import { computeEmblemLoadout, sumEmblemFlats } from "../../emblems";
import { roundEmblemTotals } from "../../formulas";

const lucario = pokemonById.get("lucario")!;

describe("deriveEmblemLoadoutImpact", () => {
  it("includes set-bonus % in emblem delta, not just flat emblem totals", () => {
    const pool = buildCandidatePool(emblems, { grades: ["gold"] });
    const browns = pool
      .filter((c) => c.colors.includes("brown") && (c.stats.attack ?? 0) > 0)
      .slice(0, 6);
    expect(browns).toHaveLength(6);

    const picks = browns.map((c) => ({ emblemId: c.id, grade: c.grade }));
    const impact = deriveEmblemLoadoutImpact(lucario, 15, picks, [], [], setBonuses);
    expect(impact).not.toBeNull();

    const slots = picksToEmblemSlots(picks);
    const roundedFlats = roundEmblemTotals(sumEmblemFlats(slots));
    const flatAttack = roundedFlats.attack ?? 0;
    const emblemAttackDelta = impact!.emblemDelta.attack ?? 0;

    expect(flatAttack).toBeGreaterThan(0);
    expect(emblemAttackDelta).toBeGreaterThan(flatAttack);
    expect(impact!.effective.attack).toBe(lucario.baseStatsByLevel[14].attack + emblemAttackDelta);
  });

  it("uses canonical emblemById stats rather than search candidate synthesis", () => {
    const pool = buildCandidatePool(emblems, { grades: ["gold"] });
    const browns = pool
      .filter((c) => c.colors.includes("brown") && (c.stats.attack ?? 0) > 0)
      .slice(0, 6);
    const picks = browns.map((c) => ({ emblemId: c.id, grade: c.grade }));

    const fromPicks = deriveEmblemLoadoutImpact(lucario, 15, picks, [], [], setBonuses);
    const syntheticSlots = candidatesToEmblemSlots(browns, setBonuses);
    const syntheticLoadout = computeEmblemLoadout(syntheticSlots, setBonuses);

    expect(fromPicks!.emblemLoadout.flatTotals.attack).toBeCloseTo(
      syntheticLoadout.flatTotals.attack ?? 0,
      5,
    );
    expect(picks.every((p) => emblemById.has(p.emblemId))).toBe(true);
  });
});
