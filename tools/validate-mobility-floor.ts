/**
 * One-off validation: compare move-speed search results with vs without mobility floor.
 * Run: node --import tsx tools/validate-mobility-floor.ts
 */
import { loadBundle } from "../src/data/loadBundle";
import rawPatch from "../src/data/patch-current.json";
import { buildPool } from "../src/engine/emblemSearch/pool";
import { buildPresetSearchOptions } from "../src/engine/emblemSearch/searchPresets";
import { runSearch } from "../src/engine/emblemSearch/orchestrator";
import { sumStats } from "../src/engine/emblemSearch/evaluate";
import { emblemToCandidate } from "../src/engine/emblemSearch/adapt";
import { deriveProtectFloors } from "../src/engine/emblemSearch/protectDefaults";
import { deriveBasicObjective } from "../src/engine/emblemSearch/basicObjective";
import { priorityWeights } from "../src/engine/recommend";

const IDS = ["sableye", "blissey", "lucario", "zeraora", "gengar"] as const;

const bundle = loadBundle(rawPatch);
const pop = bundle.pokemon;

async function searchMoveSpeed(id: string, withMobilityFloor: boolean) {
  const pokemon = pop.find((p) => p.id === id)!;
  const pool = buildPool(
    bundle.emblems,
    { useOwned: false, mixedGrades: true, allowedGrades: new Set(["gold", "silver", "bronze"]) },
    new Set(),
  );
  const { options } = buildPresetSearchOptions({
    pokemon,
    level: 15,
    pool,
    emblems: bundle.emblems,
    pokemonList: pop,
    forceHeuristic: true,
  });
  const protectedFloors = withMobilityFloor
    ? options.protected
    : Object.fromEntries(
        Object.entries(options.protected).filter(([k]) => k !== "moveSpeed"),
      );
  const result = await runSearch({
    pool,
    options: { ...options, protected: protectedFloors },
    setBonuses: bundle.setBonuses,
    effort: "quick",
  });
  const totals = sumStats(
    result!.picks.map((slot) => emblemToCandidate(slot.emblem, slot.grade!)),
  );
  return {
    moveSpeed: totals.moveSpeed ?? 0,
    hp: totals.hp ?? 0,
    picks: result!.picks
      .filter((s) => (s.emblem.statsByGrade[s.grade!]?.moveSpeed ?? 0) < 0)
      .map((s) => `${s.emblem.pokemonName}(${s.grade})`),
  };
}

console.log("=== Per-Pokemon defaults ===\n");
for (const id of IDS) {
  const pokemon = pop.find((p) => p.id === id)!;
  const floors = deriveProtectFloors(pokemon, pop, 15);
  const weights = priorityWeights(pokemon);
  console.log(
    `${id.padEnd(12)} role=${pokemon.role.padEnd(11)} moveSpdWeight=${weights.moveSpeed ?? 0} floors=${JSON.stringify(floors)}`,
  );
}

console.log("\n=== Search comparison (current vs without moveSpeed floor) ===\n");
console.log(
  "id".padEnd(12),
  "role".padEnd(12),
  "current ms".padEnd(12),
  "no-floor ms".padEnd(12),
  "neg-ms picks",
);
console.log("-".repeat(80));

for (const id of IDS) {
  const pokemon = pop.find((p) => p.id === id)!;
  process.stdout.write(`Searching ${id}... `);
  const current = await searchMoveSpeed(id, true);
  const noFloor = await searchMoveSpeed(id, false);
  console.log(
    `${id.padEnd(12)}`,
    `${pokemon.role.padEnd(12)}`,
    `${String(current.moveSpeed).padEnd(12)}`,
    `${String(noFloor.moveSpeed).padEnd(12)}`,
    current.picks.join(", ") || "(none)",
  );
}
