/**
 * Exact color-constrained enumeration.
 *
 * Architecture (clean-room port of uniteemblemfinder's color-exact search):
 *  1. buildColorTargetGroups — groups the pool's distinct Pokémon names by
 *     their color signature over the constrained colors.
 *  2. enumerateColorKVectors — enumerate valid per-group pick-count vectors
 *     (k-vectors) via backward feasibility + forward DFS.
 *  3. searchColorExactSlice — for a contiguous range [start, start+size) of
 *     the global enumeration ordering, iterate within-group combinations via
 *     a combination odometer (starting at the correct position via unranking).
 *     Used by both the single-threaded path (full range) and parallel shard
 *     workers (partial ranges).
 *  4. searchColorExact — thin wrapper: builds groups + k-vectors, calls
 *     searchColorExactSlice over the full range.
 *
 * Total enumerated = sum_kVec prod_g C(n_g, k[g]) when enumerateGradeVariants
 * is false; multiplied by grade-variant products per name combo when true.
 * Grade fast path resolves one variant via bestVariantForMode per name combo.
 * No pool-size gate — bounded by constrained count vs exactCap.
 *
 * Provenance: clean-room TypeScript port of uniteemblemfinder.github.io (AGPL).
 * No code copied verbatim.
 */

import type { EmblemColor, EmblemSetBonus } from "../../types";
import type { EmblemCandidate, SearchOptions } from "./types";
import { evaluateLoadout, candidateGreedyValue, isBetter, type EvalResult } from "./evaluate";

// ---------------------------------------------------------------------------
// Color-type group
// ---------------------------------------------------------------------------

/**
 * A color-type group: all distinct Pokémon names that carry the same subset
 * of the constrained colors. `vec[j] = 1` if every member carries the j-th
 * constrained color.
 */
export interface ColorGroup {
  vec: number[];
  names: string[];
}

/**
 * Group the pool's distinct Pokémon names by their color signature over the
 * constrained colors. Mirrors uniteemblemfinder's colorTargetGroups().
 * Colors are grade-independent; group membership depends only on pokemonName.
 */
export function buildColorTargetGroups(
  pool: EmblemCandidate[],
  colorConstraints: Map<EmblemColor, number>,
): ColorGroup[] {
  const checked = [...colorConstraints.keys()];
  const byName = new Map<string, EmblemColor[]>();
  for (const c of pool) {
    if (!byName.has(c.pokemonName)) byName.set(c.pokemonName, c.colors);
  }
  const groupMap = new Map<string, ColorGroup>();
  for (const [name, colors] of byName.entries()) {
    const vec = checked.map((col) => (colors.includes(col) ? 1 : 0));
    const key = vec.join(",");
    const g = groupMap.get(key) ?? { vec, names: [] };
    g.names.push(name);
    groupMap.set(key, g);
  }
  return [...groupMap.values()];
}

// ---------------------------------------------------------------------------
// k-vector enumeration
// ---------------------------------------------------------------------------

/**
 * Enumerate all valid per-group pick-count vectors (k-vectors) satisfying:
 *   sum(k) == slots, sum_g k[g]*group.vec == targetVec, 0 ≤ k[g] ≤ sizes[g].
 *
 * Exported so the parallel coordinator (exactParallel.ts) can re-use the same
 * k-vectors without recomputing them inside each shard.
 *
 * Returns [] when infeasible, null when patterns exceed MAX_KVECTORS (safety).
 */
export function enumerateColorKVectors(
  groups: ColorGroup[],
  sizes: number[],
  targetVec: number[],
  slots: number,
  shouldAbort?: () => boolean,
): number[][] | null {
  const G = groups.length;
  const nColors = targetVec.length;
  const goalKey = `${slots}|${targetVec.join(",")}`;
  const zeroKey = `0|${targetVec.map(() => 0).join(",")}`;

  // Phase 0: backward feasibility
  const feasible: Set<string>[] = Array.from({ length: G + 1 });
  feasible[G] = new Set([goalKey]);
  for (let gi = G - 1; gi >= 0; gi--) {
    const cur = new Set<string>();
    for (const key of feasible[gi + 1]) {
      const bar = key.indexOf("|");
      const su = +key.slice(0, bar);
      const counts = key
        .slice(bar + 1)
        .split(",")
        .map(Number);
      for (let x = 0; x <= sizes[gi]; x++) {
        const ps = su - x;
        if (ps < 0) break;
        const pc = counts.slice();
        let ok = true;
        for (let j = 0; j < nColors; j++) {
          pc[j] -= x * groups[gi].vec[j];
          if (pc[j] < 0) {
            ok = false;
            break;
          }
        }
        if (!ok) break;
        cur.add(`${ps}|${pc.join(",")}`);
      }
    }
    feasible[gi] = cur;
  }

  if (!feasible[0].has(zeroKey)) return [];

  // Phase 1: forward DFS
  const MAX_KVECTORS = 10_000_000;
  const kVectors: number[][] = [];
  type Frame = { gi: number; su: number; counts: number[]; k: number[] };
  const stack: Frame[] = [{ gi: 0, su: 0, counts: targetVec.map(() => 0), k: [] }];
  while (stack.length) {
    if (shouldAbort?.()) return null;
    const fr = stack.pop()!;
    if (fr.gi === G) {
      kVectors.push(fr.k);
      if (kVectors.length > MAX_KVECTORS) return null;
      continue;
    }
    const g = groups[fr.gi];
    for (let x = 0; x <= sizes[fr.gi]; x++) {
      const ns = fr.su + x;
      if (ns > slots) break;
      const nc = fr.counts.slice();
      let ok = true;
      for (let j = 0; j < nColors; j++) {
        nc[j] += x * g.vec[j];
        if (nc[j] > targetVec[j]) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
      if (!feasible[fr.gi + 1].has(`${ns}|${nc.join(",")}`)) continue;
      stack.push({ gi: fr.gi + 1, su: ns, counts: nc, k: fr.k.concat(x) });
    }
  }
  return kVectors;
}

// ---------------------------------------------------------------------------
// Range-based enumeration — parallel shard API
// ---------------------------------------------------------------------------

/** Minimum total builds before parallel sharding pays off. */
export const EXACT_PARALLEL_MIN = 50_000;

/**
 * Number-valued binomial coefficient.
 * Safe for n, k ≤ exactCap < 2^53. Uses Math.round to neutralise
 * floating-point drift accumulated across repeated (num*(n-i))/(i+1) divisions.
 */
export function binomNum(n: number, k: number): number {
  if (k > n || k < 0) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < k; i++) r = Math.round((r * (n - i)) / (i + 1));
  return r;
}

/**
 * Lexicographically unrank the rank-th k-subset of {0…n-1}.
 * Matches the ordering produced by nextCombo starting at [0, 1, …, k-1].
 *
 * Algorithm (combinadic / factorial number system):
 *   For each position i, scan v = start…n to find smallest v with
 *   C(n-1-v, k-1-i) > remaining rank; that v is result[i].
 */
export function unrankCombination(n: number, k: number, rank: number): number[] {
  const result = Array.from<number>({ length: k });
  let r = rank;
  let start = 0;
  for (let i = 0; i < k; i++) {
    for (let v = start; v < n; v++) {
      const cnt = binomNum(n - 1 - v, k - 1 - i);
      if (r < cnt) {
        result[i] = v;
        start = v + 1;
        break;
      }
      r -= cnt;
    }
  }
  return result;
}

/**
 * Decode a within-kVector local index into per-group odometer starting states.
 * Group G-1 is LEAST significant (matches the carry-from-right order of
 * resetCombo/nextCombo); local=0 produces [[0,1,…,k[0]-1], …, [0,1,…,k[G-1]-1]].
 *
 * Algorithm: mixed-radix decomposition where radix[gi] = C(sizes[gi], k[gi]),
 * then unrank each per-group remainder.
 */
export function unrankLocalState(sizes: number[], k: number[], local: number): number[][] {
  const G = sizes.length;
  const radix = k.map((kg, gi) => binomNum(sizes[gi], kg) || 1);
  const r = Array.from({ length: G }, () => 0);
  for (let gi = G - 1; gi >= 0; gi--) {
    r[gi] = local % radix[gi];
    local = Math.floor(local / radix[gi]);
  }
  return k.map((kg, gi) => unrankCombination(sizes[gi], kg, r[gi]));
}

/**
 * Prefix sums of per-kVector combination counts (Number, safe ≤ 1e9 < 2^53).
 * kPrefix[j] = global start index of k-vector j.
 * kPrefix[kVectors.length] = total build count.
 */
export function computeKPrefix(sizes: number[], kVectors: number[][]): number[] {
  const prefix = [0];
  for (const k of kVectors) {
    let w = 1;
    for (let gi = 0; gi < sizes.length; gi++) w *= binomNum(sizes[gi], k[gi]);
    prefix.push(prefix[prefix.length - 1] + w);
  }
  return prefix;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ExactColorResult {
  loadout: EmblemCandidate[];
  ev: EvalResult;
  evaluated: number;
}

// ---------------------------------------------------------------------------
// Combination odometer helpers (shared by all enumeration paths)
// ---------------------------------------------------------------------------

function resetCombo(idx: number[], k: number): void {
  for (let i = 0; i < k; i++) idx[i] = i;
}

function nextCombo(idx: number[], k: number, n: number): boolean {
  if (k === 0) return false;
  let i = k - 1;
  while (i >= 0 && idx[i] === n - k + i) i--;
  if (i < 0) return false;
  idx[i]++;
  for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  return true;
}

function assembleNames(groups: ColorGroup[], k: number[], idxs: number[][]): string[] {
  const names: string[] = [];
  for (let gi = 0; gi < groups.length; gi++) {
    if (k[gi] === 0) continue;
    const gnames = groups[gi].names;
    for (const t of idxs[gi]) names.push(gnames[t]);
  }
  return names;
}

function variantProductForNames(
  names: string[],
  variantsByName: Map<string, EmblemCandidate[]>,
): number {
  let product = 1;
  for (const name of names) product *= variantsByName.get(name)!.length;
  return product;
}

function unrankGradeIndices(
  names: string[],
  variantsByName: Map<string, EmblemCandidate[]>,
  rank: number,
): number[] {
  const counts = names.map((name) => variantsByName.get(name)!.length);
  const indices = Array.from({ length: names.length }, () => 0);
  let r = rank;
  for (let i = names.length - 1; i >= 0; i--) {
    indices[i] = r % counts[i];
    r = Math.floor(r / counts[i]);
  }
  return indices;
}

function nextGradeIndices(
  indices: number[],
  names: string[],
  variantsByName: Map<string, EmblemCandidate[]>,
): boolean {
  for (let i = indices.length - 1; i >= 0; i--) {
    const max = variantsByName.get(names[i])!.length;
    indices[i]++;
    if (indices[i] < max) return true;
    indices[i] = 0;
  }
  return false;
}

/**
 * Prefix sums of evaluation counts per k-vector when grade variants are
 * enumerated. evalPrefix[j] = global start index of k-vector j;
 * evalPrefix[kVectors.length] = total evaluations.
 */
export function computeGradeAwareKPrefix(
  groups: ColorGroup[],
  sizes: number[],
  kVectors: number[][],
  variantsByName: Map<string, EmblemCandidate[]>,
): number[] {
  const G = groups.length;
  const prefix = [0];

  for (const k of kVectors) {
    let kTotal = 0;
    const idxs = k.map((kg) => Array.from({ length: kg }, (_, i) => i));
    const comboCount = k.reduce((acc, kg, gi) => acc * (binomNum(sizes[gi], kg) || 1), 1);

    for (let c = 0; c < comboCount; c++) {
      const names = assembleNames(groups, k, idxs);
      kTotal += variantProductForNames(names, variantsByName);

      if (c + 1 >= comboCount) break;
      let carry = true;
      for (let gi = G - 1; gi >= 0 && carry; gi--) {
        if (nextCombo(idxs[gi], k[gi], sizes[gi])) carry = false;
        else resetCombo(idxs[gi], k[gi]);
      }
    }
    prefix.push(prefix[prefix.length - 1] + kTotal);
  }
  return prefix;
}

interface EvalSliceState {
  j: number;
  k: number[];
  idxs: number[][];
  gradeIndices: number[];
}

function decodeEvalPosition(
  evalPrefix: number[],
  kVectors: number[][],
  groups: ColorGroup[],
  sizes: number[],
  variantsByName: Map<string, EmblemCandidate[]>,
  pos: number,
  enumerateGrades: boolean,
): EvalSliceState {
  let lo = 0;
  let hi = kVectors.length - 1;
  let j = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (evalPrefix[mid] <= pos) {
      j = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }

  const k = kVectors[j];
  const localInK = pos - evalPrefix[j];

  if (!enumerateGrades) {
    return {
      j,
      k,
      idxs: unrankLocalState(sizes, k, localInK),
      gradeIndices: [],
    };
  }

  const G = groups.length;
  const idxs = k.map((kg) => Array.from({ length: kg }, (_, i) => i));
  const comboCount = k.reduce((acc, kg, gi) => acc * (binomNum(sizes[gi], kg) || 1), 1);
  let acc = 0;

  for (let c = 0; c < comboCount; c++) {
    const names = assembleNames(groups, k, idxs);
    const gradeCount = variantProductForNames(names, variantsByName);
    if (acc + gradeCount > localInK) {
      return {
        j,
        k,
        idxs: idxs.map((idx) => idx.slice()),
        gradeIndices: unrankGradeIndices(names, variantsByName, localInK - acc),
      };
    }
    acc += gradeCount;

    if (c + 1 >= comboCount) break;
    let carry = true;
    for (let gi = G - 1; gi >= 0 && carry; gi--) {
      if (nextCombo(idxs[gi], k[gi], sizes[gi])) carry = false;
      else resetCombo(idxs[gi], k[gi]);
    }
  }

  return {
    j,
    k,
    idxs: k.map((kg) => Array.from({ length: kg }, (_, i) => i)),
    gradeIndices: [],
  };
}

function advanceNameOdometer(
  state: EvalSliceState,
  kVectors: number[][],
  sizes: number[],
): boolean {
  const G = sizes.length;
  let carry = true;
  for (let gi = G - 1; gi >= 0 && carry; gi--) {
    if (nextCombo(state.idxs[gi], state.k[gi], sizes[gi])) carry = false;
    else resetCombo(state.idxs[gi], state.k[gi]);
  }
  if (!carry) return true;

  state.j++;
  if (state.j >= kVectors.length) return false;
  state.k = kVectors[state.j];
  state.idxs = state.k.map((kg) => Array.from({ length: kg }, (_, i) => i));
  return true;
}

// ---------------------------------------------------------------------------
// Core: range-based enumeration (single-thread full range OR parallel shard)
// ---------------------------------------------------------------------------

/**
 * Enumerate the contiguous range [startGlobal, startGlobal + sliceSize) of
 * the global exact-search ordering and return the best-scoring result.
 *
 * Global ordering: k-vectors in fixed order from enumerateColorKVectors;
 * within each k-vector, group G-1 is the innermost (least-significant) loop —
 * matching the carry order of nextCombo/resetCombo. The starting position is
 * decoded via unranking so any range can be entered without iterating from 0.
 *
 * Called by searchColorExact (full range, startGlobal=0, sliceSize=totalCombos)
 * and by exactShard.worker.ts (partial ranges). Both execute identical logic.
 *
 * @param onProgress - Receives the CUMULATIVE evaluated count for this slice.
 *   Parallel shards use this to report per-shard progress toward global total.
 */
export async function searchColorExactSlice(
  pool: EmblemCandidate[],
  opts: SearchOptions,
  setBonuses: EmblemSetBonus[],
  groups: ColorGroup[],
  kVectors: number[][],
  kPrefix: number[],
  startGlobal: number,
  sliceSize: number,
  onProgress?: (evaluated: number) => Promise<void>,
  shouldAbort?: () => boolean,
): Promise<ExactColorResult | null> {
  if (sliceSize <= 0 || kVectors.length === 0) return null;

  const sizes = groups.map((g) => g.names.length);
  const endGlobal = startGlobal + sliceSize;
  const enumerateGrades = opts.enumerateGradeVariants ?? false;

  const variantsByName = new Map<string, EmblemCandidate[]>();
  for (const c of pool) {
    if (!variantsByName.has(c.pokemonName)) variantsByName.set(c.pokemonName, []);
    variantsByName.get(c.pokemonName)!.push(c);
  }

  const evalPrefix = enumerateGrades
    ? computeGradeAwareKPrefix(groups, sizes, kVectors, variantsByName)
    : kPrefix;

  let state = decodeEvalPosition(
    evalPrefix,
    kVectors,
    groups,
    sizes,
    variantsByName,
    startGlobal,
    enumerateGrades,
  );

  let evaluated = 0;
  let best: { loadout: EmblemCandidate[]; ev: EvalResult } | null = null;
  let sliceEnd = Date.now() + 40;
  const reportEvery = Math.max(1, Math.floor(sliceSize / 100));
  let nextReport = reportEvery;

  for (let evalGlobal = startGlobal; evalGlobal < endGlobal; ) {
    if (shouldAbort?.()) return null;

    const names = assembleNames(groups, state.k, state.idxs);
    const loadout = enumerateGrades
      ? names.map((name, i) => variantsByName.get(name)![state.gradeIndices[i]])
      : names.map((name) => bestVariantForMode(variantsByName.get(name)!, opts));
    const ev = evaluateLoadout(loadout, opts, setBonuses);
    evaluated++;
    evalGlobal++;

    if (ev.valid && isBetter(ev, best?.ev ?? null, opts)) {
      best = { loadout: loadout.slice(), ev };
    }

    if (evaluated >= nextReport || Date.now() >= sliceEnd) {
      if (onProgress) await onProgress(evaluated);
      sliceEnd = Date.now() + 40;
      nextReport = evaluated + reportEvery;
    }

    if (evalGlobal >= endGlobal) break;

    if (enumerateGrades && nextGradeIndices(state.gradeIndices, names, variantsByName)) {
      continue;
    }
    if (enumerateGrades) {
      state.gradeIndices = names.map(() => 0);
    }
    if (!advanceNameOdometer(state, kVectors, sizes)) break;
  }

  if (!best) return null;
  return { loadout: best.loadout, ev: best.ev, evaluated };
}

// ---------------------------------------------------------------------------
// Public single-threaded search (delegates to searchColorExactSlice)
// ---------------------------------------------------------------------------

/**
 * Exact color-constrained search over the full pool.
 * Builds groups + k-vectors, then delegates to searchColorExactSlice.
 * No pool-size gate; bounded by constrained count vs exactCap (caller checks).
 */
export async function searchColorExact(
  pool: EmblemCandidate[],
  opts: SearchOptions,
  setBonuses: EmblemSetBonus[],
  onProgress?: (pct: number, label: string, evaluated: number) => Promise<void>,
  shouldAbort?: () => boolean,
): Promise<ExactColorResult | null> {
  const targets = opts.colorConstraints;
  if (!targets || targets.size === 0) return null;

  const slots = opts.slots;
  const checked = [...targets.keys()];
  const targetVec = checked.map((col) => targets.get(col)!);

  const groups = buildColorTargetGroups(pool, targets);
  const sizes = groups.map((g) => g.names.length);

  if (shouldAbort?.()) return null;

  const kVectors = enumerateColorKVectors(groups, sizes, targetVec, slots, shouldAbort);
  if (kVectors === null || kVectors.length === 0) return null;

  const kPrefix = computeKPrefix(sizes, kVectors);
  const enumerateGrades = opts.enumerateGradeVariants ?? false;

  const variantsByName = new Map<string, EmblemCandidate[]>();
  for (const c of pool) {
    if (!variantsByName.has(c.pokemonName)) variantsByName.set(c.pokemonName, []);
    variantsByName.get(c.pokemonName)!.push(c);
  }

  const evalPrefix = enumerateGrades
    ? computeGradeAwareKPrefix(groups, sizes, kVectors, variantsByName)
    : kPrefix;
  const totalCombos = evalPrefix[evalPrefix.length - 1];

  const result = await searchColorExactSlice(
    pool,
    opts,
    setBonuses,
    groups,
    kVectors,
    kPrefix,
    0,
    totalCombos,
    onProgress
      ? async (ev) => {
          const pct = 3 + Math.min(96, (ev / Math.max(1, totalCombos)) * 96);
          await onProgress(pct, "Exact search…", ev);
        }
      : undefined,
    shouldAbort,
  );

  if (result && onProgress) {
    await onProgress(99, "Exact search…", result.evaluated);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Grade-picking helper (shared by all enumeration paths)
// ---------------------------------------------------------------------------

/** Pick the best grade variant for a Pokémon depending on the objective. */
function bestVariantForMode(variants: EmblemCandidate[], opts: SearchOptions): EmblemCandidate {
  if (variants.length === 1) return variants[0];
  if (opts.mode === "maximize") {
    let best = variants[0];
    let bestV = candidateGreedyValue(variants[0], opts);
    for (let i = 1; i < variants.length; i++) {
      const v = candidateGreedyValue(variants[i], opts);
      if (v > bestV) {
        bestV = v;
        best = variants[i];
      }
    }
    return best;
  }
  // Target mode: grade closest to per-slot average target
  let best = variants[0];
  let bestDist = Infinity;
  for (const c of variants) {
    let dist = 0;
    for (const [stat, active] of Object.entries(opts.targetActive)) {
      if (!active) continue;
      const target = (opts.targets[stat as keyof typeof opts.targets] ?? 0) / opts.slots;
      dist += Math.abs((c.stats[stat as keyof typeof c.stats] ?? 0) - target);
    }
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** BigInt binomial (for countConstrainedBuilds compatibility). */
function binomBig(n: number, k: number): bigint {
  if (k > n || k < 0) return 0n;
  if (k === 0 || k === n) return 1n;
  k = Math.min(k, n - k);
  let num = 1n;
  for (let i = 0; i < k; i++) num = (num * BigInt(n - i)) / BigInt(i + 1);
  return num;
}

// Keep BigInt version available for pool.ts countConstrainedBuilds if needed
export { binomBig };

// ---------------------------------------------------------------------------
// Pool-facing helpers (used by UI)
// ---------------------------------------------------------------------------

/**
 * For each constrained color, how many distinct Pokémon in the pool carry it?
 */
export function colorGroupSizes(pool: EmblemCandidate[]): Map<EmblemColor, number> {
  const seen = new Map<EmblemColor, Set<string>>();
  for (const c of pool) {
    for (const col of c.colors) {
      if (!seen.has(col)) seen.set(col, new Set());
      seen.get(col)!.add(c.pokemonName);
    }
  }
  return new Map([...seen].map(([col, s]) => [col, s.size]));
}
