/**
 * Heuristic search: greedy seeding + hill-climbing + simulated annealing.
 *
 * Provenance: clean-room TypeScript reimplementation of runHeuristic() from
 * uniteemblemfinder.github.io search_worker.js. The SA schedule and
 * neighborhood structure are independently designed to suit FoxForge's needs.
 */

import type { EmblemSetBonus } from "../../types";
import type { EmblemCandidate, SearchOptions } from "./types";
import {
  evaluateLoadout,
  candidateGreedyValue,
  isBetter,
  colorsMatchTargets,
  countColorsRaw,
  type EvalResult,
} from "./evaluate";

export interface HeuristicResult {
  loadout: EmblemCandidate[];
  ev: EvalResult;
  candidates: number;
  tries: number;
}

// ---------------------------------------------------------------------------
// Effort presets
// ---------------------------------------------------------------------------

interface Preset {
  budgetMs?: number;
  restarts?: number;
  improvePasses?: number;
}

function getPreset(effort: "quick" | "normal" | "thorough"): Preset {
  switch (effort) {
    case "quick": return { budgetMs: 1_500 };
    case "normal": return { budgetMs: 8_000 };
    case "thorough": return { budgetMs: 25_000 };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function colorNeedsRemaining(
  loadout: EmblemCandidate[],
  colorTargets: Map<string, number>,
): Map<string, number> {
  const counts = countColorsRaw(loadout);
  const needs = new Map<string, number>();
  for (const [color, need] of colorTargets) {
    needs.set(color, Math.max(0, need - (counts.get(color as never) ?? 0)));
  }
  return needs;
}

function wouldExceedTargets(
  loadout: EmblemCandidate[],
  candidate: EmblemCandidate,
  targets: Map<string, number>,
): boolean {
  const counts = countColorsRaw(loadout);
  for (const col of candidate.colors) {
    const need = targets.get(col);
    if (need === undefined) continue;
    if ((counts.get(col as never) ?? 0) + 1 > need) return true;
  }
  return false;
}

function colorHelp(c: EmblemCandidate, needs: Map<string, number>): number {
  let h = 0;
  for (const col of c.colors) if ((needs.get(col) ?? 0) > 0) h++;
  return h;
}

/** Build one loadout that exactly satisfies color targets (returns null if impossible). */
function colorExactSeed(
  shuffledPool: EmblemCandidate[],
  colorTargets: Map<string, number>,
  opts: SearchOptions,
  slots: number,
): EmblemCandidate[] | null {
  const loadout: EmblemCandidate[] = [];
  const names = new Set<string>();

  while (loadout.length < slots) {
    const needs = colorNeedsRemaining(loadout, colorTargets);
    const avail = shuffledPool.filter(
      (c) => !names.has(c.pokemonName) && !wouldExceedTargets(loadout, c, colorTargets),
    );
    if (!avail.length) return null;
    const pending = [...needs.values()].some((n) => n > 0);
    const cands = pending ? avail.filter((c) => colorHelp(c, needs) > 0) : avail;
    if (!cands.length) return null;

    // Pick best by greedy value with color-help priority
    cands.sort((a, b) => {
      const ha = colorHelp(a, needs);
      const hb = colorHelp(b, needs);
      if (hb !== ha) return hb - ha;
      return candidateGreedyValue(b, opts) - candidateGreedyValue(a, opts);
    });
    // Jitter to avoid identical seeds
    const tier = cands.slice(0, Math.min(8, cands.length));
    const picked = tier[Math.floor(Math.random() * tier.length)];
    if (!picked) return null;
    loadout.push(picked);
    names.add(picked.pokemonName);
  }

  return colorsMatchTargets(countColorsRaw(loadout), opts.colorConstraints) ? loadout : null;
}

/** Greedy seed: pick best-scoring distinct-Pokémon emblems. */
function greedySeed(
  shuffledPool: EmblemCandidate[],
  opts: SearchOptions,
  slots: number,
  setBonuses: EmblemSetBonus[],
): EmblemCandidate[] {
  const loadout: EmblemCandidate[] = [];
  const names = new Set<string>();
  for (const c of shuffledPool) {
    if (loadout.length >= slots) break;
    if (names.has(c.pokemonName)) continue;
    const trial = [...loadout, c];
    if (evaluateLoadout(trial, opts, setBonuses).valid) {
      loadout.push(c);
      names.add(c.pokemonName);
    }
  }
  return loadout;
}

/** One-pass hill-climb: try swapping each slot for a better candidate. */
function hillClimb(
  loadout: EmblemCandidate[],
  pool: EmblemCandidate[],
  opts: SearchOptions,
  setBonuses: EmblemSetBonus[],
  counter: { n: number },
): { loadout: EmblemCandidate[]; ev: EvalResult } {
  let best = loadout.slice();
  let bestEv = evaluateLoadout(best, opts, setBonuses);
  counter.n++;

  const scan = opts.colorConstraints ? shuffle(pool).slice(0, 48) : pool;
  let improved = true;
  let rounds = 0;
  const maxRounds = opts.colorConstraints ? 1 : 3;

  while (improved && rounds < maxRounds) {
    improved = false;
    rounds++;
    for (let slot = 0; slot < best.length; slot++) {
      const names = new Set(best.filter((_, i) => i !== slot).map((x) => x.pokemonName));
      for (const cand of scan) {
        if (names.has(cand.pokemonName)) continue;
        const trial = best.slice();
        trial[slot] = cand;
        const ev = evaluateLoadout(trial, opts, setBonuses);
        counter.n++;
        if (isBetter(ev, bestEv, opts)) {
          best = trial;
          bestEv = ev;
          improved = true;
        }
      }
    }
  }
  return { loadout: best, ev: bestEv };
}

// ---------------------------------------------------------------------------
// Simulated annealing (large-pool no-color-constraint case)
// ---------------------------------------------------------------------------

interface AnnealState {
  cur: EmblemCandidate[];
  curEv: EvalResult;
  curNames: Set<string>;
}

function annealEnergy(ev: EvalResult, opts: SearchOptions): number {
  return opts.mode === "target" ? (ev.error ?? Infinity) : -ev.score;
}

function runAnnealSegment(
  pool: EmblemCandidate[],
  sortedPool: EmblemCandidate[],
  variantsByName: Map<string, EmblemCandidate[]>,
  opts: SearchOptions,
  setBonuses: EmblemSetBonus[],
  slots: number,
  counter: { n: number },
): { loadout: EmblemCandidate[]; ev: EvalResult } {
  // Seed from sorted pool
  const used = new Set<string>();
  const start = Math.floor(Math.random() * Math.min(6, sortedPool.length));
  const L: EmblemCandidate[] = [];
  for (let i = start; i < sortedPool.length && L.length < slots; i++) {
    const c = sortedPool[i];
    if (!used.has(c.pokemonName)) { used.add(c.pokemonName); L.push(c); }
  }
  for (let i = 0; i < sortedPool.length && L.length < slots; i++) {
    const c = sortedPool[i];
    if (!used.has(c.pokemonName)) { used.add(c.pokemonName); L.push(c); }
  }
  if (L.length < slots) return { loadout: L, ev: evaluateLoadout(L, opts, setBonuses) };

  const state: AnnealState = {
    cur: L,
    curEv: evaluateLoadout(L, opts, setBonuses),
    curNames: new Set(L.map((x) => x.pokemonName)),
  };
  counter.n++;

  let best = state.cur.slice();
  let bestEv = state.curEv;

  // Calibrate temperature
  const moves = Math.max(400, Math.min(4000, pool.length * 4));
  let T0 = 0;
  let samples = 0;
  for (let probe = 0; probe < 24; probe++) {
    const nb = neighbor(state, sortedPool, variantsByName, slots);
    if (!nb) continue;
    const ev = evaluateLoadout(nb.trial, opts, setBonuses);
    counter.n++;
    T0 += Math.abs(annealEnergy(ev, opts) - annealEnergy(state.curEv, opts));
    samples++;
  }
  T0 = samples ? (T0 / samples) : Math.max(1, Math.abs(annealEnergy(state.curEv, opts)) * 0.05);
  if (!(T0 > 0)) T0 = 1;
  const Tmin = Math.max(T0 * 1e-3, 1e-9);
  const alpha = Math.exp(Math.log(Tmin / T0) / moves);
  let T = T0;

  for (let m = 0; m < moves; m++) {
    const nb = neighbor(state, sortedPool, variantsByName, slots);
    if (nb) {
      const ev = evaluateLoadout(nb.trial, opts, setBonuses);
      counter.n++;
      const dE = annealEnergy(ev, opts) - annealEnergy(state.curEv, opts);
      if (dE <= 0 || Math.random() < Math.exp(-dE / T)) {
        state.cur = nb.trial;
        state.curEv = ev;
        if (nb.oldName !== nb.newName) {
          state.curNames.delete(nb.oldName);
          state.curNames.add(nb.newName);
        }
        if (isBetter(state.curEv, bestEv, opts)) {
          best = state.cur.slice();
          bestEv = state.curEv;
        }
      }
    }
    T *= alpha;
    if (T < Tmin) T = Tmin;
  }

  return { loadout: best, ev: bestEv };
}

interface Neighbor {
  trial: EmblemCandidate[];
  oldName: string;
  newName: string;
}

function neighbor(
  state: AnnealState,
  sortedPool: EmblemCandidate[],
  variantsByName: Map<string, EmblemCandidate[]>,
  slots: number,
): Neighbor | null {
  const slot = Math.floor(Math.random() * slots);
  if (Math.random() < 0.78) {
    // Replace with a different Pokémon
    for (let a = 0; a < 6; a++) {
      const c = Math.random() < 0.6
        ? sortedPool[Math.floor(Math.random() * Math.min(120, sortedPool.length))]
        : sortedPool[Math.floor(Math.random() * sortedPool.length)];
      if (!c) continue;
      if (c.pokemonName !== state.cur[slot].pokemonName && state.curNames.has(c.pokemonName)) continue;
      const trial = state.cur.slice();
      trial[slot] = c;
      return { trial, oldName: state.cur[slot].pokemonName, newName: c.pokemonName };
    }
    return null;
  }
  // Grade swap within same Pokémon
  const vs = variantsByName.get(state.cur[slot].pokemonName);
  if (!vs || vs.length < 2) return null;
  let v = vs[Math.floor(Math.random() * vs.length)];
  if (v === state.cur[slot]) v = vs[(vs.indexOf(v) + 1) % vs.length];
  const trial = state.cur.slice();
  trial[slot] = v;
  return { trial, oldName: state.cur[slot].pokemonName, newName: v.pokemonName };
}

// ---------------------------------------------------------------------------
// Main heuristic runner
// ---------------------------------------------------------------------------

/**
 * Run heuristic search (greedy-seed or SA + hill-climb) on the pool.
 *
 * Uses simulated annealing when the pool has enough Pokémon and no exact
 * color constraints. Falls back to greedy+hill-climb otherwise.
 */
export async function runHeuristic(
  pool: EmblemCandidate[],
  opts: SearchOptions,
  setBonuses: EmblemSetBonus[],
  effort: "quick" | "normal" | "thorough",
  onProgress?: (pct: number, label: string, candidates: number) => Promise<void>,
  shouldAbort?: () => boolean,
): Promise<HeuristicResult> {
  const preset = getPreset(effort);
  const slots = opts.slots;
  const counter = { n: 0 };
  let globalBest: { loadout: EmblemCandidate[]; ev: EvalResult } = {
    loadout: [],
    ev: { valid: false, score: -1e12, totals: {}, colorCounts: new Map() },
  };
  const t0 = Date.now();
  let tries = 0;

  const useAnneal =
    !opts.colorConstraints &&
    new Set(pool.map((c) => c.pokemonName)).size >= slots;

  const sortedPool = useAnneal
    ? pool.slice().sort((a, b) => candidateGreedyValue(b, opts) - candidateGreedyValue(a, opts))
    : [];

  const variantsByName = new Map<string, EmblemCandidate[]>();
  if (useAnneal) {
    for (const c of pool) {
      if (!variantsByName.has(c.pokemonName)) variantsByName.set(c.pokemonName, []);
      variantsByName.get(c.pokemonName)!.push(c);
    }
  }

  // Initial color-exact seed
  if (opts.colorConstraints) {
    const seeded = colorExactSeed(shuffle(pool), opts.colorConstraints as Map<string, number>, opts, slots);
    if (seeded?.length === slots) {
      const ev = evaluateLoadout(seeded, opts, setBonuses);
      counter.n++;
      if (isBetter(ev, globalBest.ev, opts)) globalBest = { loadout: seeded, ev };
    }
  }

  function oneTry(): { loadout: EmblemCandidate[]; ev: EvalResult } {
    if (useAnneal) {
      return runAnnealSegment(pool, sortedPool, variantsByName, opts, setBonuses, slots, counter);
    }
    let L: EmblemCandidate[];
    if (opts.colorConstraints && globalBest.loadout.length === slots && Math.random() < 0.9) {
      // Mutate current best
      L = mutateSolution(globalBest.loadout, pool, opts, slots);
    } else if (opts.colorConstraints) {
      L = colorExactSeed(shuffle(pool), opts.colorConstraints as Map<string, number>, opts, slots) ?? [];
    } else {
      L = greedySeed(shuffle(pool), opts, slots, setBonuses);
    }
    if (L.length < slots) {
      const names = new Set(L.map((x) => x.pokemonName));
      for (const c of shuffle(pool)) {
        if (L.length >= slots) break;
        if (names.has(c.pokemonName)) continue;
        const trial = [...L, c];
        if (evaluateLoadout(trial, opts, setBonuses).valid) { L = trial; names.add(c.pokemonName); }
      }
    }
    return hillClimb(L, pool, opts, setBonuses, counter);
  }

  const budgetMs = preset.budgetMs ?? 5000;
  while (Date.now() - t0 < budgetMs && !(shouldAbort?.())) {
    const sliceEnd = Date.now() + 48;
    while (Date.now() - t0 < budgetMs && Date.now() < sliceEnd && !(shouldAbort?.())) {
      const res = oneTry();
      if (isBetter(res.ev, globalBest.ev, opts)) globalBest = res;
      tries++;
    }
    if (onProgress) {
      const elapsed = Date.now() - t0;
      const pct = Math.min(99, (elapsed / budgetMs) * 100);
      await onProgress(pct, "Smart search…", counter.n);
    }
  }

  // Emit a final 100% when the budget completes normally (in-loop progress is
  // capped at 99 so it never claims "done" early). Skipped on abort so a
  // cancelled search doesn't flash a full bar.
  if (onProgress && !(shouldAbort?.())) {
    await onProgress(100, "Smart search…", counter.n);
  }

  return { loadout: globalBest.loadout, ev: globalBest.ev, candidates: counter.n, tries };
}

function mutateSolution(
  loadout: EmblemCandidate[],
  pool: EmblemCandidate[],
  opts: SearchOptions,
  slots: number,
): EmblemCandidate[] {
  if (!opts.colorConstraints || loadout.length !== slots) return loadout.slice();
  const trial = loadout.slice();
  const swaps = 1 + Math.floor(Math.random() * 2);
  for (let s = 0; s < swaps; s++) {
    const slot = Math.floor(Math.random() * slots);
    const names = new Set(trial.filter((_, i) => i !== slot).map((x) => x.pokemonName));
    const cands = shuffle(pool.filter((c) => !names.has(c.pokemonName))).slice(0, 40);
    for (const c of cands) {
      if (wouldExceedTargets(trial.filter((_, i) => i !== slot), c, opts.colorConstraints!)) continue;
      trial[slot] = c;
      break;
    }
  }
  return trial;
}
