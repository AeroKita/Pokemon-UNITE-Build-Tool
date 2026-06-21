import { loadBundle } from "../../src/data/loadBundle";
import rawPatch from "../../src/data/patch-current.json";
import {
  deriveColorTargets,
  snapColorTargetUp,
  bonusPctFor,
  colorTargetDominanceOrder,
  isUsableBuild,
  RECOMMENDED_WEIGHT,
  CREATIVE_WEIGHT,
  derivePriorities,
} from "./generate-presets";
import { buildCandidatePool } from "../../src/engine/emblemSearch/adapt";
import { countConstrainedBuilds } from "../../src/engine/emblemSearch/pool";
import { colorGroupSizes } from "../../src/engine/emblemSearch/exactColor";
import type { EmblemColor } from "../../src/types";

const bundle = loadBundle(rawPatch);
const byId = new Map(bundle.emblems.map((e) => [e.id, e]));
const bonusByColor = new Map(bundle.setBonuses.map((d) => [d.color, d]));
const pool = buildCandidatePool(bundle.emblems, {
  grades: ["bronze", "silver", "gold"],
  mixedGrades: true,
});

function feasible(targets: Partial<Record<EmblemColor, number>>) {
  const m = new Map(
    Object.entries(targets).filter(([, n]) => (n ?? 0) > 0) as [EmblemColor, number][],
  );
  const caps = colorGroupSizes(pool);
  if (![...m.entries()].every(([c, n]) => n <= (caps.get(c) ?? 0))) return false;
  const c = countConstrainedBuilds(pool, m, 10);
  return c !== 0n && c !== null;
}

console.log("=== Tied-dominance snap candidates ===\n");
for (const pokemon of bundle.pokemon) {
  const recommended = (pokemon.builds ?? []).filter((b) => isUsableBuild(b, byId));
  const creative = (pokemon.creativeBuilds ?? []).filter((b) => isUsableBuild(b, byId));
  const all = [...recommended, ...creative];
  if (all.length === 0) continue;

  const before = deriveColorTargets(
    [
      ...recommended.map((build) => ({ build, weight: RECOMMENDED_WEIGHT })),
      ...creative.map((build) => ({ build, weight: CREATIVE_WEIGHT })),
    ],
    byId,
  );
  const order = colorTargetDominanceOrder(before);
  const topCount = before[order[0]!];
  const tiedAtTop = order.filter((c) => before[c] === topCount);
  if (tiedAtTop.length < 2) continue;

  const snapCandidates = tiedAtTop
    .map((c) => {
      const from = before[c]!;
      const to = snapColorTargetUp(from, bonusByColor.get(c));
      if (to === from) return null;
      const trial = { ...before, [c]: to };
      const def = bonusByColor.get(c)!;
      return {
        color: c,
        stat: def.stat,
        from,
        to,
        tier: `${(bonusPctFor(def, from) * 100).toFixed(0)}%→${(bonusPctFor(def, to) * 100).toFixed(0)}%`,
        feasible: feasible(trial),
      };
    })
    .filter(Boolean);

  if (snapCandidates.length === 0) continue;

  const baseStats =
    pokemon.baseStatsByLevel[pokemon.baseStatsByLevel.length - 1] ?? pokemon.baseStatsByLevel[0];
  const priorities = derivePriorities(
    all.map((b) => {
      const candidates = b.emblems
        .map((p) => byId.get(p.emblemId))
        .filter((e): e is NonNullable<typeof e> => !!e);
      return candidates.reduce(
        (acc, e) => {
          const stats = e.statsByGrade.gold;
          for (const [k, v] of Object.entries(stats)) {
            acc[k as keyof typeof acc] = (acc[k as keyof typeof acc] ?? 0) + (v ?? 0);
          }
          return acc;
        },
        {} as Record<string, number>,
      );
    }),
    before,
    baseStats,
    bundle.setBonuses,
  );

  console.log(`${pokemon.id} (${pokemon.role}, ${pokemon.attackType})`);
  console.log(`  shell: ${JSON.stringify(before)}`);
  console.log(`  priorities: ${JSON.stringify(priorities)}`);
  for (const c of snapCandidates) {
    console.log(
      `  snap ${c!.color} (${c!.stat}): ${c!.from}→${c!.to} [${c!.tier}] feasible=${c!.feasible}`,
    );
  }
  console.log();
}
