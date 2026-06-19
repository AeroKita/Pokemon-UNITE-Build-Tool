/**
 * Parallel heuristic search.
 *
 * The heuristic is restart-based (independent greedy/SA + hill-climb attempts),
 * which is embarrassingly parallel: we run one full heuristic search per shard
 * worker over the same pool and time budget, each with independent worker-local
 * RNG, then merge the best result across shards. More restarts in the same wall
 * clock generally yields better (or equal) solution quality. Mirrors the
 * structure of searchColorExactParallel.
 *
 * Falls back to null (→ orchestrator runs single-threaded runHeuristic) when
 * workers are unavailable, there are too few cores, or any shard fails before
 * producing a result.
 */

import type { EmblemCandidate, SearchOptions } from "./types";
import type { EmblemSetBonus } from "../../types";
import { isBetter } from "./evaluate";
import type { HeuristicResult } from "./heuristic";

const MIN_SHARDS = 2;
const MAX_SHARDS = 8;

let jobSerial = 0;

/** Number of shard workers to use, or 0 when parallel isn't worthwhile/available. */
export function heuristicShardCount(): number {
  if (typeof navigator === "undefined") return 0;
  const cores = navigator.hardwareConcurrency || 2;
  if (cores < MIN_SHARDS) return 0;
  return Math.min(MAX_SHARDS, cores);
}

/**
 * Merge per-shard heuristic results: pick the best by isBetter, and sum the
 * candidate/try counts across all shards. Pure (no workers) so it is unit
 * testable. Returns null when no shard produced a result.
 */
export function mergeHeuristicResults(
  results: ReadonlyArray<HeuristicResult | null>,
  shardEval: ReadonlyArray<number>,
  opts: SearchOptions,
): HeuristicResult | null {
  let best: HeuristicResult | null = null;
  let totalEval = 0;
  let totalTries = 0;
  for (let i = 0; i < results.length; i++) {
    totalEval += shardEval[i] ?? 0;
    const r = results[i];
    if (!r) continue;
    totalTries += r.tries;
    if (!best || isBetter(r.ev, best.ev, opts)) best = r;
  }
  return best ? { ...best, candidates: totalEval, tries: totalTries } : null;
}

/**
 * Run heuristic search in parallel across multiple shard workers.
 *
 * @returns The best result merged across shards, or null if parallel isn't
 *   available / fails (orchestrator falls back to single-threaded runHeuristic).
 */
export async function runHeuristicParallel(
  pool: EmblemCandidate[],
  opts: SearchOptions,
  setBonuses: EmblemSetBonus[],
  effort: "quick" | "normal" | "thorough",
  onProgress?: (pct: number, label: string, candidates: number) => Promise<void>,
  shouldAbort?: () => boolean,
): Promise<HeuristicResult | null> {
  if (typeof Worker === "undefined") return null;

  const n = heuristicShardCount();
  if (n < MIN_SHARDS) return null;

  if (shouldAbort?.()) return null;

  const jobId = `heuristic-${++jobSerial}`;

  return new Promise<HeuristicResult | null>((resolve) => {
    const workers: Worker[] = [];
    const shardEval = new Array<number>(n).fill(0);
    const shardPct = new Array<number>(n).fill(0);
    const results: (HeuristicResult | null)[] = new Array(n).fill(null);
    let doneCount = 0;
    let resolved = false;

    const cleanup = (cancel = false) => {
      clearInterval(abortPoll);
      workers.forEach((w) => {
        if (cancel) { try { w.postMessage({ type: "cancel", id: jobId }); } catch {} }
        try { w.terminate(); } catch {}
      });
    };

    const finalize = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(mergeHeuristicResults(results, shardEval, opts));
    };

    const emitProgress = () => {
      const sum = shardEval.reduce((a, b) => a + b, 0);
      const avgPct = shardPct.reduce((a, b) => a + b, 0) / n;
      onProgress?.(
        Math.min(99, avgPct),
        `Smart search · ${n} workers`,
        sum,
      );
    };

    // Periodically check the external abort signal.
    const abortPoll = setInterval(() => {
      if (shouldAbort?.() && !resolved) {
        resolved = true;
        cleanup(true);
        resolve(null);
      }
    }, 100);

    try {
      for (let i = 0; i < n; i++) {
        const worker = new Worker(
          new URL("../../workers/heuristicShard.worker.ts", import.meta.url),
          { type: "module" },
        );
        workers.push(worker);

        worker.addEventListener("message", (ev: MessageEvent) => {
          const msg = ev.data;
          if (msg.id !== jobId || msg.shardIndex !== i) return;

          if (msg.type === "progress") {
            shardEval[i] = msg.evaluated ?? 0;
            shardPct[i] = msg.pct ?? 0;
            emitProgress();
          } else if (msg.type === "done") {
            if (!msg.cancelled && msg.result) {
              results[i] = msg.result;
              shardEval[i] = msg.result.candidates;
            }
            shardPct[i] = 100;
            if (++doneCount === n) {
              // All shards finished — emit a true 100% (emitProgress caps
              // in-flight updates at 99) so the bar visibly completes before
              // the orchestrator returns and the overlay closes.
              const sum = shardEval.reduce((a, b) => a + b, 0);
              onProgress?.(100, `Smart search · ${n} workers`, sum);
              finalize();
            } else {
              emitProgress();
            }
          } else if (msg.type === "error") {
            // Any shard failure → abort all → fall back to single-thread.
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
          type: "runHeuristic",
          id: jobId,
          shardIndex: i,
          pool,
          opts,
          setBonuses,
          effort,
        });
      }
    } catch {
      // Worker construction failed (old browser / strict CSP / test env).
      cleanup();
      if (!resolved) { resolved = true; resolve(null); }
    }
  });
}
