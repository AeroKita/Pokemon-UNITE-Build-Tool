import { loadBundle } from "../../src/data/loadBundle";
import rawPatch from "../../src/data/patch-current.json";
import {
  deriveColorTargets,
  snapColorTargetUp,
  bonusPctFor,
  isUsableBuild,
  RECOMMENDED_WEIGHT,
  CREATIVE_WEIGHT,
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

for (const pokemon of bundle.pokemon) {
  const recommended = (pokemon.builds ?? []).filter((b) => isUsableBuild(b, byId));
  const creative = (pokemon.creativeBuilds ?? []).filter((b) => isUsableBuild(b, byId));
  if (recommended.length + creative.length === 0) continue;

  const before = deriveColorTargets(
    [
      ...recommended.map((build) => ({ build, weight: RECOMMENDED_WEIGHT })),
      ...creative.map((build) => ({ build, weight: CREATIVE_WEIGHT })),
    ],
    byId,
  );

  const candidates: { color: EmblemColor; from: number; to: number; count: number }[] = [];
  for (const [color, from] of Object.entries(before) as [EmblemColor, number][]) {
    const to = snapColorTargetUp(from, bonusByColor.get(color));
    if (to === from) continue;
    const trial = { ...before, [color]: to };
    if (feasible(trial)) candidates.push({ color, from, to, count: from });
  }
  if (candidates.length < 2) continue;

  const maxCount = Math.max(...candidates.map((c) => c.count));
  const tied = candidates.filter((c) => c.count === maxCount);
  if (tied.length < 2) continue;

  console.log(
    `${pokemon.id}: ${JSON.stringify(before)} → multiple feasible snaps at top tier:`,
    tied.map((c) => `${c.color} ${c.from}→${c.to}`).join(", "),
  );
}
