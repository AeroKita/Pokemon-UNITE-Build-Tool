/**
 * Parallel exact color-constrained search.
 *
 * Splits the global enumeration space [0, totalCombos) into N contiguous
 * ranges (one per shard worker) and dispatches each to an exactShard.worker.ts
 * instance. Each worker independently evaluates its slice via unranking +
 * combination odometer, posts progress, and returns its best candidate.
 *
 * Progress aggregation: each shard posts a cumulative `evaluated` count;
 * the coordinator sums across shards and divides by the global total to
 * produce a single progress fraction — identical to the reference approach
 * in uniteemblemfinder's searchColorExactParallel (clean-room port).
 *
 * Result merge: the best result across all shards is selected with isBetter.
 *
 * Falls back to null (→ orchestrator uses single-threaded searchColorExact)
 * when: workers are unavailable, constrainedCount < EXACT_PARALLEL_MIN, or
 * any worker fails.
 */

import type { EmblemCandidate, SearchOptions } from "./types";
import type { EmblemSetBonus } from "../../types";
import {
  type ExactColorResult,
  buildColorTargetGroups,
  enumerateColorKVectors,
  computeKPrefix,
  computeGradeAwareKPrefix,
  EXACT_PARALLEL_MIN,
} from "./exactColor";
import { isBetter } from "./evaluate";

const MIN_SHARDS = 2;
const MAX_SHARDS = 8;

let jobSerial = 0;

function shardCount(total: number): number {
  if (typeof navigator === "undefined") return 0;
  const cores = navigator.hardwareConcurrency || 2;
  // Never use more shards than makes sense for the load
  const maxSensible = Math.ceil(total / 5_000);
  return Math.min(MAX_SHARDS, Math.max(MIN_SHARDS, cores), maxSensible);
}

/**
 * Run exact color search in parallel across multiple shard workers.
 *
 * @param constrainedCount - Pre-computed total from countExactEnumerationSpace
 *   (the caller already verified it is ≤ exactCap and ≥ 0).
 * @returns The best result across all shards, or null if parallel isn't
 *   available / fails (orchestrator falls back to single-threaded).
 */
export async function searchColorExactParallel(
  pool: EmblemCandidate[],
  opts: SearchOptions,
  setBonuses: EmblemSetBonus[],
  constrainedCount: number,
  onProgress?: (pct: number, label: string, evaluated: number) => Promise<void>,
  shouldAbort?: () => boolean,
): Promise<ExactColorResult | null> {
  if (typeof Worker === "undefined") return null;
  if (constrainedCount < EXACT_PARALLEL_MIN) return null;

  const targets = opts.colorConstraints;
  if (!targets || targets.size === 0) return null;

  const checked = [...targets.keys()];
  const targetVec = checked.map((col) => targets.get(col)!);

  const groups = buildColorTargetGroups(pool, targets);
  const sizes = groups.map((g) => g.names.length);

  if (shouldAbort?.()) return null;

  const kVectors = enumerateColorKVectors(groups, sizes, targetVec, opts.slots, shouldAbort);
  if (!kVectors || kVectors.length === 0) return null;

  const kPrefix = computeKPrefix(sizes, kVectors);
  const enumerateGrades = opts.enumerateGradeVariants ?? false;

  let totalCombos: number;
  if (enumerateGrades) {
    const variantsByName = new Map<string, EmblemCandidate[]>();
    for (const c of pool) {
      if (!variantsByName.has(c.pokemonName)) variantsByName.set(c.pokemonName, []);
      variantsByName.get(c.pokemonName)!.push(c);
    }
    const evalPrefix = computeGradeAwareKPrefix(groups, sizes, kVectors, variantsByName);
    totalCombos = evalPrefix[evalPrefix.length - 1];
  } else {
    totalCombos = kPrefix[kPrefix.length - 1];
  }

  // Guard: kPrefix total must match constrainedCount (same DP, just Number vs BigInt)
  if (totalCombos !== constrainedCount) return null;

  const n = shardCount(totalCombos);
  if (n < MIN_SHARDS) return null;

  // Balanced ranges: each shard gets ≈ totalCombos / n builds
  const base = Math.floor(totalCombos / n);
  type Range = { startGlobal: number; sliceSize: number };
  const ranges: Range[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const start = acc;
    const size = i === n - 1 ? totalCombos - start : Math.min(totalCombos - start, base);
    ranges.push({ startGlobal: start, sliceSize: size });
    acc += size;
  }

  const jobId = `exact-${++jobSerial}`;

  return new Promise<ExactColorResult | null>((resolve) => {
    const workers: Worker[] = [];
    const shardEval = Array.from({ length: n }, () => 0);
    const results: (ExactColorResult | null)[] = Array.from({ length: n }, () => null);
    let doneCount = 0;
    let resolved = false;

    const cleanup = (cancel = false) => {
      clearInterval(abortPoll);
      workers.forEach((w) => {
        if (cancel) {
          try {
            w.postMessage({ type: "cancel", id: jobId });
          } catch {}
        }
        try {
          w.terminate();
        } catch {}
      });
    };

    const finalize = () => {
      if (resolved) return;
      resolved = true;
      cleanup();

      // Merge: pick best across all shards
      let best: ExactColorResult | null = null;
      let totalEvaluated = 0;
      for (let i = 0; i < n; i++) {
        totalEvaluated += shardEval[i];
        const r = results[i];
        if (!r) continue;
        if (!best || isBetter(r.ev, best.ev, opts)) best = r;
      }
      if (best) {
        resolve({ ...best, evaluated: totalEvaluated });
      } else {
        resolve(null);
      }
    };

    const emitProgress = () => {
      const sum = Math.min(
        totalCombos,
        shardEval.reduce((a, b) => a + b, 0),
      );
      const pct = 3 + Math.min(96, (sum / Math.max(1, totalCombos)) * 96);
      onProgress?.(pct, `Exact · ${n} workers`, sum);
    };

    // Periodically check the external abort signal
    const abortPoll = setInterval(() => {
      if (shouldAbort?.() && !resolved) {
        resolved = true;
        cleanup(true);
        resolve(null);
      }
    }, 100);

    try {
      for (let i = 0; i < n; i++) {
        const worker = new Worker(new URL("../../workers/exactShard.worker.ts", import.meta.url), {
          type: "module",
        });
        workers.push(worker);

        worker.addEventListener("message", (ev: MessageEvent) => {
          const msg = ev.data;
          if (msg.id !== jobId || msg.shardIndex !== i) return;

          if (msg.type === "progress") {
            // Each shard reports CUMULATIVE count for its slice
            shardEval[i] = msg.evaluated ?? 0;
            emitProgress();
          } else if (msg.type === "done") {
            if (!msg.cancelled && msg.result) results[i] = msg.result;
            // On completion, fill to the full slice size so global % reaches 100
            shardEval[i] = ranges[i].sliceSize;
            emitProgress();
            if (++doneCount === n) finalize();
          } else if (msg.type === "error") {
            // Any shard failure → abort all → fall back to single-thread
            if (!resolved) {
              resolved = true;
              cleanup(true);
              resolve(null);
            }
          }
        });

        worker.addEventListener("error", () => {
          if (!resolved) {
            resolved = true;
            cleanup(true);
            resolve(null);
          }
        });

        worker.postMessage({
          type: "runExactRange",
          id: jobId,
          shardIndex: i,
          pool,
          opts,
          setBonuses,
          groups,
          kVectors,
          kPrefix,
          startGlobal: ranges[i].startGlobal,
          sliceSize: ranges[i].sliceSize,
          slots: opts.slots,
        });
      }
    } catch {
      // Worker construction failed (old browser / strict CSP / test env)
      cleanup();
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    }
  });
}
