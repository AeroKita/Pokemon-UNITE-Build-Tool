/**
 * Two-phase dominant snap analysis.
 * Run: node --import tsx tools/meta-defaults/analyze-threshold-snap.ts
 */
import { loadBundle } from "../../src/data/loadBundle";
import rawPatch from "../../src/data/patch-current.json";
import {
  bonusPctFor,
  buildStatTotals,
  CREATIVE_WEIGHT,
  deriveColorTargets,
  derivePriorities,
  generatePresetForPokemon,
  isUsableBuild,
  RECOMMENDED_WEIGHT,
  snapColorTargetUp,
  colorTargetDominanceOrder,
  leastDominantColorTarget,
  snapColorTargetsWithRelaxation,
} from "./generate-presets";
import { buildCandidatePool } from "../../src/engine/emblemSearch/adapt";
import type { EmblemColor } from "../../src/types";

const bundle = loadBundle(rawPatch);
const byId = new Map(bundle.emblems.map((e) => [e.id, e]));
const bonusByColor = new Map(bundle.setBonuses.map((d) => [d.color, d]));
const fullPool = buildCandidatePool(bundle.emblems, {
  grades: ["bronze", "silver", "gold"],
  mixedGrades: true,
});

function snapWithRelaxation(
  before: Partial<Record<EmblemColor, number>>,
  priorities: ReturnType<typeof derivePriorities>,
) {
  const after = snapColorTargetsWithRelaxation(before, bundle.setBonuses, fullPool, priorities);
  const changed = (Object.keys({ ...before, ...after }) as EmblemColor[]).some(
    (c) => (before[c] ?? 0) !== (after[c] ?? 0),
  );
  if (!changed) {
    return { after: before, up: null, down: null, phase: "none" as const };
  }

  const downColor = (Object.keys(before) as EmblemColor[]).find(
    (c) => (after[c] ?? 0) < (before[c] ?? 0),
  );
  const upColor = (Object.keys(after) as EmblemColor[]).find(
    (c) => (after[c] ?? 0) > (before[c] ?? 0),
  );

  const down =
    downColor !== undefined
      ? {
          color: downColor,
          from: before[downColor]!,
          to: after[downColor]!,
          tier: `${(bonusPctFor(bonusByColor.get(downColor)!, before[downColor]!) * 100).toFixed(0)}% → ${(bonusPctFor(bonusByColor.get(downColor)!, after[downColor]!) * 100).toFixed(0)}%`,
        }
      : null;

  const up =
    upColor !== undefined
      ? {
          color: upColor,
          from: before[upColor] ?? 0,
          to: after[upColor]!,
          tier: `${(bonusPctFor(bonusByColor.get(upColor)!, before[upColor] ?? 0) * 100).toFixed(0)}% → ${(bonusPctFor(bonusByColor.get(upColor)!, after[upColor]!) * 100).toFixed(0)}%`,
        }
      : null;

  return {
    after,
    up,
    down,
    phase: down ? ("down-then-up" as const) : ("up-only" as const),
  };
}

const winners: {
  id: string;
  before: Partial<Record<EmblemColor, number>>;
  after: Partial<Record<EmblemColor, number>>;
  phase: string;
  up: NonNullable<ReturnType<typeof snapWithRelaxation>["up"]>;
  down: ReturnType<typeof snapWithRelaxation>["down"];
}[] = [];
const failed: {
  id: string;
  before: Partial<Record<EmblemColor, number>>;
  least: EmblemColor | null;
}[] = [];
let totalPresets = 0;

for (const pokemon of bundle.pokemon) {
  const recommended = (pokemon.builds ?? []).filter((b) => isUsableBuild(b, byId));
  const creative = (pokemon.creativeBuilds ?? []).filter((b) => isUsableBuild(b, byId));
  if (recommended.length + creative.length === 0) continue;

  const preset = generatePresetForPokemon(pokemon, byId, bundle.setBonuses, bundle.emblems);
  if (!preset) continue;
  totalPresets++;

  const before = deriveColorTargets(
    [
      ...recommended.map((build) => ({ build, weight: RECOMMENDED_WEIGHT })),
      ...creative.map((build) => ({ build, weight: CREATIVE_WEIGHT })),
    ],
    byId,
  );
  const all = [...recommended, ...creative];
  const totalsList = all.map((b) => buildStatTotals(b, byId));
  const baseStats =
    pokemon.baseStatsByLevel[pokemon.baseStatsByLevel.length - 1] ?? pokemon.baseStatsByLevel[0];
  const priorities = derivePriorities(totalsList, before, baseStats, bundle.setBonuses);
  const result = snapWithRelaxation(before, priorities);
  if (result.phase === "none") {
    if (
      colorTargetDominanceOrder(before).some(
        (c) => snapColorTargetUp(before[c]!, bonusByColor.get(c)) !== before[c],
      )
    ) {
      failed.push({
        id: pokemon.id,
        before,
        least: leastDominantColorTarget(before, priorities, bonusByColor),
      });
    }
    continue;
  }

  winners.push({
    id: pokemon.id,
    before,
    after: result.after,
    phase: result.phase,
    up: result.up!,
    down: result.down,
  });
}

winners.sort((a, b) => a.id.localeCompare(b.id));
failed.sort((a, b) => a.id.localeCompare(b.id));

console.log(
  `Dominant snap + relaxation (full pool, ${fullPool.length} candidates): ${winners.length} / ${totalPresets}\n`,
);

for (const r of winners) {
  const downPart = r.down
    ? `down ${r.down.color} ${r.down.from}→${r.down.to} (${r.down.tier}), `
    : "";
  console.log(
    `${r.id.padEnd(16)} [${r.phase}] ${downPart}up ${r.up.color} ${r.up.from}→${r.up.to} (${r.up.tier})`,
  );
  console.log(
    `${"".padEnd(16)}  before ${JSON.stringify(r.before)} → after ${JSON.stringify(r.after)}`,
  );
}

console.log("\n--- Still no snap ---");
for (const r of failed) {
  console.log(`${r.id.padEnd(16)} least=${r.least}  ${JSON.stringify(r.before)}`);
}

console.log("\n--- Summary ---");
console.log(`Up-only:        ${winners.filter((r) => r.phase === "up-only").length}`);
console.log(`Down then up:   ${winners.filter((r) => r.phase === "down-then-up").length}`);
console.log(`Failed:         ${failed.length}`);
console.log("\nAffected Pokémon:");
console.log(winners.map((r) => r.id).join(", "));
