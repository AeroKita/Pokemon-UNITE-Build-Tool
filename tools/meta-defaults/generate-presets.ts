/**
 * Per-Pokémon emblem-optimizer preset generator.
 *
 * Derives an {@link EmblemOptimizerPreset} for every Pokémon that has enough
 * community signal (UNITE-DB `builds[]` + `creativeBuilds[]` with 10-emblem
 * sets) and writes them to `src/data/emblemOptimizerPresets.json`. Pokémon
 * without usable builds, with no positive flat investment, or below the
 * confidence threshold are omitted so the engine falls back to the role-generic
 * derivation (priorityWeights + deriveProtectFloors + colorTargetsFor).
 *
 * Derivation (algorithm v1):
 *  - priorities       : per-stat median of POSITIVE flat totals, normalized by
 *                       STAT_NORM, rescaled so the top stat = 1.0 (the Advanced
 *                       UI's 0–1 "importance" scale). Stats below MIN_PRIORITY
 *                       are dropped.
 *  - protectedFloors  : clamp(min(0, round(p10))) per stat — "don't net-reduce"
 *                       (floor 0) or the community-tolerated negative tax. Move
 *                       speed gets a 0 floor when every build keeps it ≥ 0.
 *  - colorTargets     : vote-weighted color counts (Recommended 1.0, Creative
 *                       0.5), rounded, keeping colors with count ≥ MIN_COLOR_COUNT;
 *                       then priority-weighted one-off tier snap up when feasible
 *                       on the full emblem pool, else relax the lowest-value
 *                       least-dominant color one tier and retry once.
 *  - confidence       : min(1, buildCount / CONFIDENCE_TARGET_BUILDS) × (1 −
 *                       average coefficient of variation of the key flat stats).
 *
 * Regenerate (PowerShell-friendly, no npx):
 *   node --import tsx tools/meta-defaults/generate-presets.ts
 *   node --import tsx tools/meta-defaults/generate-presets.ts --dry   # preview, no write
 *
 * Re-run whenever patch-current.json builds change. The output is consumed by
 * src/engine/emblemSearch/optimizerPresets.ts.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadBundle } from "../../src/data/loadBundle";
import rawPatch from "../../src/data/patch-current.json";
import { STAT_NORM, sumStats } from "../../src/engine/emblemSearch/evaluate";
import { buildCandidatePool, emblemToCandidate } from "../../src/engine/emblemSearch/adapt";
import { colorGroupSizes } from "../../src/engine/emblemSearch/exactColor";
import { countConstrainedBuilds } from "../../src/engine/emblemSearch/pool";
import type { EmblemCandidate } from "../../src/engine/emblemSearch/types";
import { colorCountsOf } from "../../src/engine/recommend";
import type {
  Emblem,
  EmblemColor,
  EmblemOptimizerPreset,
  EmblemSetBonus,
  Pokemon,
  PokemonBuild,
  StatBlock,
} from "../../src/types";

// ---------------------------------------------------------------------------
// Tunable constants
// ---------------------------------------------------------------------------

/** Stats eligible to become priorities (emblems contribute these as flat values). */
export const PRESET_STATS: (keyof StatBlock)[] = [
  "hp",
  "attack",
  "defense",
  "spAttack",
  "spDefense",
  "critRate",
  "cdr",
  "lifesteal",
  "spLifesteal",
  "attackSpeed",
  "moveSpeed",
];

/**
 * Stats that get a data-driven protect floor. These are the flat stats an emblem
 * set can meaningfully push negative; the percentage stats come from set bonuses,
 * not flat emblems, so they are not floored.
 */
export const FLOOR_STATS: (keyof StatBlock)[] = [
  "hp",
  "attack",
  "defense",
  "spAttack",
  "spDefense",
  "moveSpeed",
];

/** Vote weights: Recommended builds count full, Creative builds count half. */
export const RECOMMENDED_WEIGHT = 1.0;
export const CREATIVE_WEIGHT = 0.5;

/** Build count at which the confidence build-count factor saturates to 1.0. */
export const CONFIDENCE_TARGET_BUILDS = 2;

/** Minimum priority (0–1) to keep a stat in the preset (drops noise). */
export const MIN_PRIORITY = 0.05;

/** Minimum vote-weighted color count to keep a color in the shell. */
export const MIN_COLOR_COUNT = 2;

/** Emblem slots used for preset color-target feasibility checks. */
export const EMBLEM_SLOTS = 10;

/** Tie-break when color counts tie (offense-first = most dominant). */
export const COLOR_DOMINANCE_RANK: EmblemColor[] = [
  "brown",
  "green",
  "blue",
  "purple",
  "white",
  "black",
  "red",
  "yellow",
  "pink",
  "navy",
  "gray",
];

/** Auto presets below this confidence are omitted → Pokémon falls back to generic. */
export const MIN_CONFIDENCE = 0.4;

// ---------------------------------------------------------------------------
// Statistics helpers (pure, unit-tested)
// ---------------------------------------------------------------------------

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function mean(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

export function stddev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  return Math.sqrt(nums.reduce((a, b) => a + (b - m) ** 2, 0) / nums.length);
}

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Linear-interpolated percentile (p in 0–100). */
export function percentile(nums: number[], p: number): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

// ---------------------------------------------------------------------------
// Build → stat totals
// ---------------------------------------------------------------------------

/** A 10-emblem build whose every emblem id resolves in the dataset is usable. */
export function isUsableBuild(build: PokemonBuild, byId: Map<string, Emblem>): boolean {
  if (build.emblems.length !== 10) return false;
  return build.emblems.every((p) => byId.has(p.emblemId));
}

/** Flat stat totals of a build's 10 emblems at their listed grades. */
export function buildStatTotals(
  build: PokemonBuild,
  byId: Map<string, Emblem>,
): Partial<StatBlock> {
  const candidates = build.emblems
    .map((p) => {
      const e = byId.get(p.emblemId);
      return e ? emblemToCandidate(e, p.grade) : null;
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);
  return sumStats(candidates);
}

// ---------------------------------------------------------------------------
// Derivations (pure, unit-tested)
// ---------------------------------------------------------------------------

/** Best positive set-bonus percent a color reaches at a given emblem count. */
export function bonusPctFor(def: EmblemSetBonus, count: number): number {
  let pct = 0;
  for (const [t, p] of Object.entries(def.thresholds)) {
    if (count >= Number(t) && p > 0) pct = Math.max(pct, p);
  }
  return pct;
}

/**
 * Stat priorities on a 0–1 scale derived from each stat's effective contribution
 * to the community build, mirroring the engine's own scoring so the preset and
 * the optimizer agree:
 *
 *  - Flat investment:  median positive flat emblem total / STAT_NORM.
 *  - Set-bonus intent: baseStat × set-bonus% / STAT_NORM, from the community
 *    color shell (colorTargets). This is essential — offense in meta emblem
 *    builds comes from the % color set bonus (e.g. 6-green Sp.Atk), NOT from the
 *    small flat emblem stats, which skew heavily toward the HP survivability
 *    shell. Without this term a special attacker would derive an HP-dominant
 *    priority and the optimizer would regress on offense.
 *
 * The summed contributions are rescaled so the dominant stat is 1.0. Stats below
 * MIN_PRIORITY are dropped. Percentage stats whose base value is 0 (cdr,
 * attackSpeed, critRate) contribute nothing here — their color shell is enforced
 * via colorTargets instead.
 */
export function derivePriorities(
  totalsList: Partial<StatBlock>[],
  colorTargets: Partial<Record<EmblemColor, number>>,
  baseStats: StatBlock,
  setBonuses: EmblemSetBonus[],
): Partial<Record<keyof StatBlock, number>> {
  const raw: Partial<Record<keyof StatBlock, number>> = {};
  const add = (stat: keyof StatBlock, v: number) => {
    if (v > 0) raw[stat] = (raw[stat] ?? 0) + v;
  };

  for (const stat of PRESET_STATS) {
    const mag = median(totalsList.map((t) => Math.max(0, t[stat] ?? 0)));
    if (mag > 0) add(stat, mag / (STAT_NORM[stat] ?? 1));
  }

  for (const def of setBonuses) {
    const count = colorTargets[def.color] ?? 0;
    if (!count) continue;
    const pct = bonusPctFor(def, count);
    if (pct <= 0) continue;
    const stat = def.stat as keyof StatBlock;
    const base = baseStats[stat] ?? 0;
    if (base <= 0) continue;
    add(stat, (base * pct) / (STAT_NORM[stat] ?? 1));
  }

  const values = Object.values(raw);
  const out: Partial<Record<keyof StatBlock, number>> = {};
  if (values.length === 0) return out;
  const max = Math.max(...values);
  if (max <= 0) return out;
  for (const stat of PRESET_STATS) {
    const v = raw[stat];
    if (v == null) continue;
    const p = round2(v / max);
    if (p >= MIN_PRIORITY) out[stat] = p;
  }
  return out;
}

/**
 * Protect floors with "don't net-reduce" semantics. Floors are capped at 0 so a
 * preset never *requires* reaching community stat levels (which could
 * over-constrain owned-pool searches) — it only forbids dropping below what
 * community builds tolerate. p10 ≥ 0 → floor 0; p10 < 0 → the tolerated tax.
 * Move speed gets a 0 floor when every build keeps it ≥ 0 (mobility guard).
 */
export function deriveProtectedFloors(
  totalsList: Partial<StatBlock>[],
): Partial<Record<keyof StatBlock, number>> {
  const floors: Partial<Record<keyof StatBlock, number>> = {};
  for (const stat of FLOOR_STATS) {
    const vals = totalsList.map((t) => t[stat] ?? 0);
    const floor = Math.min(0, Math.round(percentile(vals, 10)));
    if (stat === "moveSpeed") {
      floors[stat] = Math.min(...vals) >= 0 ? 0 : floor;
      continue;
    }
    // Keep only stats the community invests in (median > 0) or tolerates negative.
    if (median(vals) > 0 || floor < 0) floors[stat] = floor;
  }
  return floors;
}

/**
 * Vote-weighted color shell: for each color, the weighted-average number of
 * emblems carrying it across all builds (Recommended 1.0, Creative 0.5), rounded
 * and kept only when ≥ MIN_COLOR_COUNT (the set-bonus-reaching threshold).
 */
/** One emblem below the next higher positive set-bonus tier. */
export function snapColorTargetUp(count: number, def: EmblemSetBonus | undefined): number {
  if (!def) return count;
  const currentPct = bonusPctFor(def, count);
  const next = Object.entries(def.thresholds)
    .map(([t, pct]) => [Number(t), pct] as const)
    .filter(([t, pct]) => t > count && pct > currentPct)
    .sort((a, b) => a[0] - b[0])[0];
  if (!next) return count;
  const [nextCount, nextPct] = next;
  if (nextCount - count !== 1 || nextPct <= currentPct) return count;
  return nextCount;
}

/** Drop one positive set-bonus tier (e.g. black 4 → 2, brown 5 → 3). */
export function snapColorTargetDownOneTier(count: number, def: EmblemSetBonus | undefined): number {
  if (!def) return count;
  const currentPct = bonusPctFor(def, count);
  if (currentPct <= 0) return count;

  for (let c = count - 1; c >= 0; c--) {
    const pct = bonusPctFor(def, c);
    if (pct < currentPct) return Math.max(c, MIN_COLOR_COUNT);
  }
  return count;
}

export function colorTargetDominanceOrder(
  targets: Partial<Record<EmblemColor, number>>,
): EmblemColor[] {
  return (Object.entries(targets) as [EmblemColor, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return COLOR_DOMINANCE_RANK.indexOf(a[0]) - COLOR_DOMINANCE_RANK.indexOf(b[0]);
    })
    .map(([c]) => c);
}

/** priority(stat) × current set-bonus % — how much the preset values keeping this color tier. */
export function colorSetBonusKeepValue(
  color: EmblemColor,
  count: number,
  priorities: Partial<Record<keyof StatBlock, number>>,
  bonusByColor: Map<EmblemColor, EmblemSetBonus>,
): number {
  const def = bonusByColor.get(color);
  if (!def) return 0;
  const priority = priorities[def.stat as keyof StatBlock] ?? 0;
  return priority * bonusPctFor(def, count);
}

/** priority(stat) × tier gain from a one-off snap up (0 when no valid snap). */
export function colorSnapUpGainScore(
  color: EmblemColor,
  count: number,
  priorities: Partial<Record<keyof StatBlock, number>>,
  bonusByColor: Map<EmblemColor, EmblemSetBonus>,
): number {
  const def = bonusByColor.get(color);
  if (!def) return 0;
  const to = snapColorTargetUp(count, def);
  if (to === count) return 0;
  const priority = priorities[def.stat as keyof StatBlock] ?? 0;
  return priority * (bonusPctFor(def, to) - bonusPctFor(def, count));
}

/** Snap-up attempt order: emblem count, then priority-weighted tier gain, then static rank. */
export function colorTargetSnapUpOrder(
  targets: Partial<Record<EmblemColor, number>>,
  priorities: Partial<Record<keyof StatBlock, number>>,
  bonusByColor: Map<EmblemColor, EmblemSetBonus>,
): EmblemColor[] {
  return (Object.entries(targets) as [EmblemColor, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      const gainDiff =
        colorSnapUpGainScore(b[0], b[1], priorities, bonusByColor) -
        colorSnapUpGainScore(a[0], a[1], priorities, bonusByColor);
      if (gainDiff !== 0) return gainDiff;
      return COLOR_DOMINANCE_RANK.indexOf(a[0]) - COLOR_DOMINANCE_RANK.indexOf(b[0]);
    })
    .map(([c]) => c);
}

/** Least dominant: lowest count; ties → lowest priority-weighted set-bonus keep value. */
export function leastDominantColorTarget(
  targets: Partial<Record<EmblemColor, number>>,
  priorities: Partial<Record<keyof StatBlock, number>>,
  bonusByColor: Map<EmblemColor, EmblemSetBonus>,
): EmblemColor | null {
  const order = colorTargetDominanceOrder(targets);
  if (order.length === 0) return null;
  const minCount = Math.min(...order.map((c) => targets[c]!));
  const tied = order.filter((c) => targets[c] === minCount);
  return (
    [...tied].sort((a, b) => {
      const keepDiff =
        colorSetBonusKeepValue(a, targets[a]!, priorities, bonusByColor) -
        colorSetBonusKeepValue(b, targets[b]!, priorities, bonusByColor);
      if (keepDiff !== 0) return keepDiff;
      return COLOR_DOMINANCE_RANK.indexOf(b) - COLOR_DOMINANCE_RANK.indexOf(a);
    })[0] ?? null
  );
}

function colorTargetsToMap(
  targets: Partial<Record<EmblemColor, number>>,
): Map<EmblemColor, number> {
  return new Map(
    Object.entries(targets).filter(([, n]) => (n ?? 0) > 0) as [EmblemColor, number][],
  );
}

function isColorTargetsFeasible(
  targets: Partial<Record<EmblemColor, number>>,
  pool: EmblemCandidate[],
): boolean {
  const map = colorTargetsToMap(targets);
  if (map.size === 0) return false;
  const sum = [...map.values()].reduce((a, b) => a + b, 0);
  if (sum > 2 * EMBLEM_SLOTS) return false;
  const caps = colorGroupSizes(pool);
  if (![...map.entries()].every(([c, n]) => n <= (caps.get(c) ?? 0))) return false;
  const builds = countConstrainedBuilds(pool, map, EMBLEM_SLOTS);
  return builds !== 0n && builds !== null;
}

function tryDominantColorSnapUp(
  targets: Partial<Record<EmblemColor, number>>,
  bonusByColor: Map<EmblemColor, EmblemSetBonus>,
  pool: EmblemCandidate[],
  priorities: Partial<Record<keyof StatBlock, number>>,
): Partial<Record<EmblemColor, number>> | null {
  for (const color of colorTargetSnapUpOrder(targets, priorities, bonusByColor)) {
    const from = targets[color]!;
    const to = snapColorTargetUp(from, bonusByColor.get(color));
    if (to === from) continue;
    const trial = { ...targets, [color]: to };
    if (isColorTargetsFeasible(trial, pool)) return trial;
  }
  return null;
}

/**
 * After vote-weighted rounding, try a one-off tier snap UP (priority-weighted among
 * tied counts). If none succeed, drop the least-valued least-dominant color one tier
 * and retry the snap once.
 */
export function snapColorTargetsWithRelaxation(
  targets: Partial<Record<EmblemColor, number>>,
  setBonuses: EmblemSetBonus[],
  pool: EmblemCandidate[],
  priorities: Partial<Record<keyof StatBlock, number>>,
): Partial<Record<EmblemColor, number>> {
  const bonusByColor = new Map(setBonuses.map((d) => [d.color, d]));

  const upFirst = tryDominantColorSnapUp(targets, bonusByColor, pool, priorities);
  if (upFirst) return upFirst;

  const least = leastDominantColorTarget(targets, priorities, bonusByColor);
  if (!least) return targets;

  const def = bonusByColor.get(least);
  const fromDown = targets[least]!;
  const toDown = snapColorTargetDownOneTier(fromDown, def);
  if (toDown === fromDown || toDown < MIN_COLOR_COUNT) return targets;

  const relaxed = { ...targets, [least]: toDown };
  if (!isColorTargetsFeasible(relaxed, pool)) return targets;

  const upRetry = tryDominantColorSnapUp(relaxed, bonusByColor, pool, priorities);
  return upRetry ?? targets;
}

export function deriveColorTargets(
  weightedBuilds: { build: PokemonBuild; weight: number }[],
  byId: Map<string, Emblem>,
): Partial<Record<EmblemColor, number>> {
  let totalWeight = 0;
  const weighted = new Map<EmblemColor, number>();
  for (const { build, weight } of weightedBuilds) {
    totalWeight += weight;
    for (const [color, n] of colorCountsOf(build.emblems, byId)) {
      weighted.set(color, (weighted.get(color) ?? 0) + weight * n);
    }
  }
  const out: Partial<Record<EmblemColor, number>> = {};
  if (totalWeight === 0) return out;
  for (const [color, w] of weighted) {
    const avg = Math.round(w / totalWeight);
    if (avg >= MIN_COLOR_COUNT) out[color] = avg;
  }
  return out;
}

/**
 * Flat stats used for build-to-build consistency (confidence). Excludes moveSpeed
 * because UNITE-DB often lists a separate mobility Recommended build (e.g.
 * Skeledirge "Mobile Special Attacker") whose emblem shell trades HP for move
 * speed while sharing the same offense role — penalizing that divergence would
 * drop otherwise-valid presets below the confidence threshold.
 */
export const CONFIDENCE_STATS: (keyof StatBlock)[] = FLOOR_STATS.filter((s) => s !== "moveSpeed");

/**
 * Each build's normalized stat distance from the median build, across
 * {@link CONFIDENCE_STATS} (STAT_NORM-scaled so stats are comparable). Used by
 * the confidence metric; exported for testing.
 */
export function buildDistances(totalsList: Partial<StatBlock>[]): number[] {
  const medians: Partial<Record<keyof StatBlock, number>> = {};
  for (const stat of CONFIDENCE_STATS) {
    medians[stat] = median(totalsList.map((t) => t[stat] ?? 0));
  }
  return totalsList.map((t) => {
    let d = 0;
    for (const stat of CONFIDENCE_STATS) {
      d += Math.abs((t[stat] ?? 0) - (medians[stat] ?? 0)) / (STAT_NORM[stat] ?? 1);
    }
    return d;
  });
}

/**
 * Confidence 0–1: combines how much data exists (build count, saturating at
 * CONFIDENCE_TARGET_BUILDS) with how consistent the builds are. Consistency uses
 * the MEDIAN normalized distance of builds from the median build, so it is
 * robust to a single divergent alt build (e.g. a mobility variant) — matching
 * the median-based priority/floor derivation, which the same outlier does not
 * move. A single clean build scores ~0.5; tightly-clustered builds approach 1.0;
 * builds that genuinely disagree across the board score lower.
 */
export function computeConfidence(buildCount: number, totalsList: Partial<StatBlock>[]): number {
  if (buildCount === 0) return 0;
  const buildFactor = Math.min(1, buildCount / CONFIDENCE_TARGET_BUILDS);
  const typicalDistance = median(buildDistances(totalsList));
  const consistency = 1 / (1 + typicalDistance);
  return round2(buildFactor * consistency);
}

/**
 * Generate the auto preset for one Pokémon, or null when it should fall back to
 * the role-generic derivation (no usable builds, no positive investment, or
 * confidence below {@link MIN_CONFIDENCE}).
 */
export function generatePresetForPokemon(
  pokemon: Pokemon,
  byId: Map<string, Emblem>,
  setBonuses: EmblemSetBonus[],
  emblems: Emblem[],
): EmblemOptimizerPreset | null {
  const recommended = (pokemon.builds ?? []).filter((b) => isUsableBuild(b, byId));
  const creative = (pokemon.creativeBuilds ?? []).filter((b) => isUsableBuild(b, byId));
  const all = [...recommended, ...creative];
  if (all.length === 0) return null;

  const totalsList = all.map((b) => buildStatTotals(b, byId));
  const rawColorTargets = deriveColorTargets(
    [
      ...recommended.map((build) => ({ build, weight: RECOMMENDED_WEIGHT })),
      ...creative.map((build) => ({ build, weight: CREATIVE_WEIGHT })),
    ],
    byId,
  );
  const baseStats =
    pokemon.baseStatsByLevel[pokemon.baseStatsByLevel.length - 1] ?? pokemon.baseStatsByLevel[0];
  const snapPriorities = derivePriorities(totalsList, rawColorTargets, baseStats, setBonuses);
  const candidatePool = buildCandidatePool(emblems, {
    grades: ["bronze", "silver", "gold"],
    mixedGrades: true,
  });
  const colorTargets = snapColorTargetsWithRelaxation(
    rawColorTargets,
    setBonuses,
    candidatePool,
    snapPriorities,
  );
  const priorities = derivePriorities(totalsList, colorTargets, baseStats, setBonuses);
  if (Object.keys(priorities).length === 0) return null;

  const confidence = computeConfidence(all.length, totalsList);
  if (confidence < MIN_CONFIDENCE) return null;

  return {
    priorities,
    protectedFloors: deriveProtectedFloors(totalsList),
    colorTargets,
    confidence,
    buildCount: all.length,
    source: "auto",
  };
}

// ---------------------------------------------------------------------------
// File output
// ---------------------------------------------------------------------------

export interface PresetsFileMeta {
  generatedFrom: string;
  patchVersion: string;
  generatedAt: string;
  algorithm: string;
  confidenceThreshold: number;
  pokemonWithPresets: number;
  pokemonFallback: number;
}

export interface PresetsFile {
  _meta: PresetsFileMeta;
  presets: Record<string, EmblemOptimizerPreset>;
}

/** Build the full presets file object (pure — used by the CLI and by tests). */
export function buildPresetsFile(
  pokemonList: Pokemon[],
  emblems: Emblem[],
  setBonuses: EmblemSetBonus[],
  patchVersion: string,
): PresetsFile {
  const byId = new Map(emblems.map((e) => [e.id, e]));
  const presets: Record<string, EmblemOptimizerPreset> = {};
  let fallback = 0;
  for (const pokemon of [...pokemonList].sort((a, b) => a.id.localeCompare(b.id))) {
    const preset = generatePresetForPokemon(pokemon, byId, setBonuses, emblems);
    if (preset) presets[pokemon.id] = preset;
    else fallback++;
  }
  return {
    _meta: {
      generatedFrom:
        "UNITE-DB community builds (patch-current.json builds[] + creativeBuilds[], 10-emblem sets)",
      patchVersion,
      generatedAt: new Date().toISOString().slice(0, 10),
      algorithm:
        "v1: priorities = normalized median positive flat magnitudes (0–1); " +
        "protectedFloors = clamp(min(0, round(p10))) with moveSpeed 0 when builds keep it ≥ 0; " +
        "colorTargets = vote-weighted (Recommended 1.0, Creative 0.5) counts ≥ 2, " +
        "then priority-weighted one-off tier snap up (full-pool feasible), else relax lowest-value least-dominant color + retry; " +
        "confidence = min(1, builds/2) × (1 − avg coefficient of variation)",
      confidenceThreshold: MIN_CONFIDENCE,
      pokemonWithPresets: Object.keys(presets).length,
      pokemonFallback: fallback,
    },
    presets,
  };
}

const OUTPUT_URL = new URL("../../src/data/emblemOptimizerPresets.json", import.meta.url);

function main() {
  const dryRun = process.argv.includes("--dry");
  const bundle = loadBundle(rawPatch);
  const file = buildPresetsFile(
    bundle.pokemon,
    bundle.emblems,
    bundle.setBonuses,
    bundle.patchVersion,
  );
  const total = bundle.pokemon.length;

  process.stderr.write(
    `Generated ${file._meta.pokemonWithPresets}/${total} presets ` +
      `(${file._meta.pokemonFallback} fall back to generic) at confidence ≥ ${MIN_CONFIDENCE}.\n`,
  );

  if (dryRun) {
    process.stdout.write(JSON.stringify(file, null, 2) + "\n");
    return;
  }

  writeFileSync(fileURLToPath(OUTPUT_URL), JSON.stringify(file, null, 2) + "\n");
  process.stderr.write(`Wrote ${fileURLToPath(OUTPUT_URL)}\n`);
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1]?.replace(/\\/g, "/").endsWith("meta-defaults/generate-presets.ts");

if (isMain) {
  main();
}
