/**
 * Heuristic search — parallel shard worker.
 *
 * Each shard runs an INDEPENDENT full heuristic search (greedy/SA + hill-climb)
 * over the same pool for the same time budget, using its own worker-local RNG
 * state so restarts diverge. The coordinator merges the best result across
 * shards and sums candidate counts — an embarrassingly-parallel restart scheme
 * (more restarts in the same wall-clock → better/equal solution quality).
 *
 * Message protocol:
 *   → { type: "runHeuristic", id, shardIndex, pool, opts, setBonuses, effort }
 *   → { type: "cancel", id }
 *   ← { type: "progress", id, shardIndex, evaluated, pct }
 *   ← { type: "done",     id, shardIndex, result, cancelled? }
 *   ← { type: "error",    id, shardIndex, message }
 */

import type { EmblemCandidate, SearchOptions } from "../engine/emblemSearch/types";
import type { EmblemSetBonus } from "../types";
import { runHeuristic, type HeuristicResult } from "../engine/emblemSearch/heuristic";

let currentJobId: string | null = null;
let cancelled = false;

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data as ShardMessage;

  if (msg.type === "cancel") {
    if (msg.id === currentJobId) cancelled = true;
    return;
  }

  if (msg.type !== "runHeuristic") return;

  currentJobId = msg.id;
  cancelled = false;

  try {
    const result = await runHeuristic(
      msg.pool,
      msg.opts,
      msg.setBonuses,
      msg.effort,
      async (pct, _label, candidates) => {
        self.postMessage({
          type: "progress",
          id: msg.id,
          shardIndex: msg.shardIndex,
          evaluated: candidates,
          pct,
        } satisfies ShardProgressMessage);
      },
      () => cancelled,
    );

    self.postMessage({
      type: "done",
      id: msg.id,
      shardIndex: msg.shardIndex,
      cancelled,
      result: cancelled ? null : result,
    } satisfies ShardDoneMessage);
  } catch (err) {
    self.postMessage({
      type: "error",
      id: msg.id,
      shardIndex: msg.shardIndex,
      message: err instanceof Error ? err.message : String(err),
    } satisfies ShardErrorMessage);
  }
};

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

interface ShardRunMessage {
  type: "runHeuristic";
  id: string;
  shardIndex: number;
  pool: EmblemCandidate[];
  opts: SearchOptions;
  setBonuses: EmblemSetBonus[];
  effort: "quick" | "normal" | "thorough";
}

interface ShardCancelMessage {
  type: "cancel";
  id: string;
}

type ShardMessage = ShardRunMessage | ShardCancelMessage;

interface ShardProgressMessage {
  type: "progress";
  id: string;
  shardIndex: number;
  evaluated: number;
  pct: number;
}

interface ShardDoneMessage {
  type: "done";
  id: string;
  shardIndex: number;
  result: HeuristicResult | null;
  cancelled?: boolean;
}

interface ShardErrorMessage {
  type: "error";
  id: string;
  shardIndex: number;
  message: string;
}
