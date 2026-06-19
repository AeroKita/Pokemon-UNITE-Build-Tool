/**
 * Batch meta-defaults analysis for emblem search floors and stat priorities.
 *
 * For each Pokémon, runs quick searches under several protect-floor / priority
 * variants and recommends settings that align better with meta mobility
 * expectations (net move speed ≥ 0 when HP-weighted builds would otherwise
 * stack −35 tax emblems).
 *
 * Run:
 *   node --import tsx tools/meta-defaults/analyze.ts
 *   node --import tsx tools/meta-defaults/analyze.ts --ids sableye,lucario --json
 *   node --import tsx tools/meta-defaults/analyze.ts --all --limit 20
 */
import { loadBundle } from "../../src/data/loadBundle";
import rawPatch from "../../src/data/patch-current.json";
import { buildPool } from "../../src/engine/emblemSearch/pool";
import { buildPresetSearchOptions } from "../../src/engine/emblemSearch/searchPresets";
import { runSearch } from "../../src/engine/emblemSearch/orchestrator";
import { sumStats } from "../../src/engine/emblemSearch/evaluate";
import { emblemToCandidate } from "../../src/engine/emblemSearch/adapt";
import { deriveProtectFloors } from "../../src/engine/emblemSearch/protectDefaults";
import { priorityWeights } from "../../src/engine/recommend";
import type { Pokemon, StatBlock } from "../../src/types";
import type { SearchOptions, StatFloors } from "../../src/engine/emblemSearch/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VariantKind =
  | "current"
  | "mobility_floor"
  | "move_speed_weight_low"
  | "move_speed_weight_mid"
  | "mobility_floor_and_weight";

export interface VariantSpec {
  kind: VariantKind;
  label: string;
  apply: (options: SearchOptions) => SearchOptions;
}

export interface VariantResult {
  kind: VariantKind;
  label: string;
  score: number;
  totals: Partial<StatBlock>;
  moveSpeed: number;
  hp: number;
  negMoveSpeedPicks: string[];
}

export interface PokemonAnalysis {
  id: string;
  displayName: string;
  role: Pokemon["role"];
  attackType: Pokemon["attackType"];
  currentFloors: StatFloors;
  currentMoveSpeedWeight: number;
  baseMoveSpeedZ: number;
  variants: VariantResult[];
  recommendation: {
    kind: VariantKind;
    label: string;
    reason: string;
    suggestedFloors: StatFloors;
    suggestedMoveSpeedWeight: number;
  };
}

// ---------------------------------------------------------------------------
// Variants to test
// ---------------------------------------------------------------------------

const MOVE_SPEED_WEIGHT_LOW = 0.3;
const MOVE_SPEED_WEIGHT_MID = 0.6;

export const VARIANTS: VariantSpec[] = [
  {
    kind: "current",
    label: "current defaults",
    apply: (o) => o,
  },
  {
    kind: "mobility_floor",
    label: `+moveSpeed floor 0`,
    apply: (o) => ({
      ...o,
      protected: { ...o.protected, moveSpeed: 0 },
    }),
  },
  {
    kind: "move_speed_weight_low",
    label: `+moveSpeed weight ${MOVE_SPEED_WEIGHT_LOW}`,
    apply: (o) => ({
      ...o,
      priorities: { ...o.priorities, moveSpeed: MOVE_SPEED_WEIGHT_LOW },
    }),
  },
  {
    kind: "move_speed_weight_mid",
    label: `+moveSpeed weight ${MOVE_SPEED_WEIGHT_MID}`,
    apply: (o) => ({
      ...o,
      priorities: { ...o.priorities, moveSpeed: MOVE_SPEED_WEIGHT_MID },
    }),
  },
  {
    kind: "mobility_floor_and_weight",
    label: `floor 0 + weight ${MOVE_SPEED_WEIGHT_LOW}`,
    apply: (o) => ({
      ...o,
      protected: { ...o.protected, moveSpeed: 0 },
      priorities: { ...o.priorities, moveSpeed: MOVE_SPEED_WEIGHT_LOW },
    }),
  },
];

// ---------------------------------------------------------------------------
// Meta scoring — pick variant closest to meta mobility without tanking score
// ---------------------------------------------------------------------------

/** Higher is better. Penalises negative net move speed; rewards non-negative. */
export function metaMobilityScore(moveSpeed: number, searchScore: number): number {
  const mobilityPenalty = moveSpeed < 0 ? Math.abs(moveSpeed) / 150 * 3 : 0;
  const mobilityBonus = moveSpeed > 0 ? (moveSpeed / 150) * 0.5 : 0;
  return searchScore - mobilityPenalty + mobilityBonus;
}

export function pickBestVariant(
  variants: VariantResult[],
  currentMoveSpeedWeight: number,
  currentFloors: StatFloors,
): PokemonAnalysis["recommendation"] {
  const baseline = variants.find((v) => v.kind === "current")!;
  const baselineMeta = metaMobilityScore(baseline.moveSpeed, baseline.score);

  let best = baseline;
  let bestMeta = baselineMeta;

  for (const v of variants) {
    const meta = metaMobilityScore(v.moveSpeed, v.score);
    if (meta > bestMeta + 1e-6) {
      best = v;
      bestMeta = meta;
    }
  }

  const suggestedFloors: StatFloors = { ...currentFloors };
  let suggestedMoveSpeedWeight = currentMoveSpeedWeight;

  if (best.kind === "mobility_floor" || best.kind === "mobility_floor_and_weight") {
    suggestedFloors.moveSpeed = 0;
  }
  if (
    best.kind === "move_speed_weight_low" ||
    best.kind === "move_speed_weight_mid" ||
    best.kind === "mobility_floor_and_weight"
  ) {
    suggestedMoveSpeedWeight =
      best.kind === "move_speed_weight_mid" ? MOVE_SPEED_WEIGHT_MID : MOVE_SPEED_WEIGHT_LOW;
  }

  let reason: string;
  if (best.kind === "current") {
    if (baseline.moveSpeed < 0) {
      reason = `Current defaults yield net move speed ${baseline.moveSpeed}; no tested variant improved meta score enough to switch.`;
    } else {
      reason = "Current defaults already produce non-negative net move speed.";
    }
  } else if (baseline.moveSpeed < 0 && best.moveSpeed >= 0) {
    reason = `Fixes negative move speed (${baseline.moveSpeed} → ${best.moveSpeed}) with minimal score change (${baseline.score.toFixed(2)} → ${best.score.toFixed(2)}).`;
  } else {
    reason = `Improves meta mobility score (${baselineMeta.toFixed(2)} → ${bestMeta.toFixed(2)}); move speed ${baseline.moveSpeed} → ${best.moveSpeed}.`;
  }

  return {
    kind: best.kind,
    label: best.label,
    reason,
    suggestedFloors,
    suggestedMoveSpeedWeight,
  };
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function moveSpeedZ(pokemon: Pokemon, allPokemon: Pokemon[], level: number): number {
  const idx = Math.max(0, Math.min(level - 1, pokemon.baseStatsByLevel.length - 1));
  const ms = pokemon.baseStatsByLevel[idx]?.moveSpeed ?? 0;
  const vals = allPokemon.map(
    (p) => p.baseStatsByLevel[Math.min(idx, p.baseStatsByLevel.length - 1)]?.moveSpeed ?? 0,
  );
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
  return (ms - mean) / std;
}

export async function analyzePokemon(
  pokemon: Pokemon,
  allPokemon: Pokemon[],
  emblems: ReturnType<typeof loadBundle>["emblems"],
  setBonuses: ReturnType<typeof loadBundle>["setBonuses"],
  level = 15,
  effort: "quick" | "normal" = "quick",
): Promise<PokemonAnalysis> {
  const pool = buildPool(
    emblems,
    { useOwned: false, mixedGrades: true, allowedGrades: new Set(["gold", "silver", "bronze"]) },
    new Set(),
  );
  const { options: baseOptions } = buildPresetSearchOptions({
    pokemon,
    level,
    pool,
    emblems,
    pokemonList: allPokemon,
    forceHeuristic: true,
  });

  const currentFloors = deriveProtectFloors(pokemon, allPokemon, level);
  const weights = priorityWeights(pokemon);
  const currentMoveSpeedWeight = weights.moveSpeed ?? 0;

  const variants: VariantResult[] = [];

  for (const spec of VARIANTS) {
    const options = spec.apply(baseOptions);
    const result = await runSearch({ pool, options, setBonuses, effort });
    const totals = sumStats(
      result!.picks.map((slot) => emblemToCandidate(slot.emblem, slot.grade!)),
    );
    const moveSpeed = totals.moveSpeed ?? 0;
    const negMoveSpeedPicks = result!.picks
      .filter((s) => (s.emblem.statsByGrade[s.grade!]?.moveSpeed ?? 0) < 0)
      .map((s) => `${s.emblem.pokemonName}(${s.grade})`);

    variants.push({
      kind: spec.kind,
      label: spec.label,
      score: result!.score ?? 0,
      totals,
      moveSpeed,
      hp: totals.hp ?? 0,
      negMoveSpeedPicks,
    });
  }

  return {
    id: pokemon.id,
    displayName: pokemon.displayName,
    role: pokemon.role,
    attackType: pokemon.attackType,
    currentFloors,
    currentMoveSpeedWeight,
    baseMoveSpeedZ: moveSpeedZ(pokemon, allPokemon, level),
    variants,
    recommendation: pickBestVariant(variants, currentMoveSpeedWeight, currentFloors),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const json = argv.includes("--json");
  const all = argv.includes("--all");
  const idsIdx = argv.indexOf("--ids");
  const ids =
    idsIdx >= 0 && argv[idsIdx + 1]
      ? argv[idsIdx + 1].split(",").map((s) => s.trim())
      : ["sableye", "blissey", "lucario", "zeraora", "gengar"];
  const limitIdx = argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(argv[limitIdx + 1]) : undefined;
  const effort = argv.includes("--normal") ? "normal" : "quick";
  return { json, all, ids, limit, effort: effort as "quick" | "normal" };
}

function printTextReport(results: PokemonAnalysis[]) {
  console.log("Meta-defaults batch analysis\n");
  for (const r of results) {
    const baseline = r.variants.find((v) => v.kind === "current")!;
    console.log(`── ${r.displayName} (${r.id}) ──`);
    console.log(`  role=${r.role}  attackType=${r.attackType}  baseMoveSpeedZ=${r.baseMoveSpeedZ.toFixed(2)}`);
    console.log(`  current floors: ${JSON.stringify(r.currentFloors)}  moveSpeed weight: ${r.currentMoveSpeedWeight}`);
    console.log(`  baseline search: moveSpeed=${baseline.moveSpeed} hp=${baseline.hp} score=${baseline.score.toFixed(2)}`);
    if (baseline.negMoveSpeedPicks.length) {
      console.log(`    neg-ms picks: ${baseline.negMoveSpeedPicks.join(", ")}`);
    }
    console.log(`  recommendation: ${r.recommendation.label}`);
    console.log(`    ${r.recommendation.reason}`);
    if (r.recommendation.kind !== "current") {
      console.log(
        `    suggested floors: ${JSON.stringify(r.recommendation.suggestedFloors)}  moveSpeed weight: ${r.recommendation.suggestedMoveSpeedWeight}`,
      );
    }
    console.log();
  }

  const needsFix = results.filter((r) => r.recommendation.kind !== "current");
  if (needsFix.length) {
    console.log("=== Summary: Pokémon benefiting from non-default settings ===");
    for (const r of needsFix) {
      console.log(
        `  ${r.id.padEnd(14)} ${r.role.padEnd(11)} → ${r.recommendation.label}`,
      );
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bundle = loadBundle(rawPatch);
  const pop = bundle.pokemon;

  let targets: Pokemon[];
  if (args.all) {
    targets = [...pop].sort((a, b) => a.displayName.localeCompare(b.displayName));
    if (args.limit) targets = targets.slice(0, args.limit);
  } else {
    targets = args.ids.map((id) => {
      const p = pop.find((x) => x.id === id);
      if (!p) throw new Error(`Unknown Pokémon id: ${id}`);
      return p;
    });
  }

  const results: PokemonAnalysis[] = [];
  for (const pokemon of targets) {
    if (!args.json) process.stderr.write(`Analyzing ${pokemon.id}... `);
    results.push(
      await analyzePokemon(pokemon, pop, bundle.emblems, bundle.setBonuses, 15, args.effort),
    );
    if (!args.json) process.stderr.write("done\n");
  }

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    printTextReport(results);
  }
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1]?.replace(/\\/g, "/").endsWith("meta-defaults/analyze.ts");

if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
