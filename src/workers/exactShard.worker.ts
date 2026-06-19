/**
 * Exact color-constrained enumeration — parallel shard worker.
 *
 * Each shard receives a contiguous range [startGlobal, startGlobal+sliceSize)
 * of the global exact-search ordering. It calls searchColorExactSlice (via
 * unranking) and returns its best candidate + evaluated count to the
 * coordinator. Progress is posted as cumulative evaluated counts; the
 * coordinator sums across shards to build a global progress fraction.
 *
 * Message protocol:
 *   → { type: "runExactRange", id, shardIndex, pool, opts, setBonuses,
 *         groups, kVectors, kPrefix, startGlobal, sliceSize, slots }
 *   → { type: "cancel", id }
 *   ← { type: "progress", id, shardIndex, evaluated }
 *   ← { type: "done",     id, shardIndex, result, cancelled? }
 *   ← { type: "error",    id, shardIndex, message }
 */

import type { EmblemCandidate, SearchOptions } from "../engine/emblemSearch/types";
import type { EmblemSetBonus } from "../types";
import {
  type ColorGroup,
  type ExactColorResult,
  searchColorExactSlice,
} from "../engine/emblemSearch/exactColor";

let currentJobId: string | null = null;
let cancelled = false;

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data as ShardMessage;

  if (msg.type === "cancel") {
    if (msg.id === currentJobId) cancelled = true;
    return;
  }

  if (msg.type !== "runExactRange") return;

  currentJobId = msg.id;
  cancelled = false;

  try {
    const result = await searchColorExactSlice(
      msg.pool,
      msg.opts,
      msg.setBonuses,
      msg.groups,
      msg.kVectors,
      msg.kPrefix,
      msg.startGlobal,
      msg.sliceSize,
      async (evaluated) => {
        self.postMessage({
          type: "progress",
          id: msg.id,
          shardIndex: msg.shardIndex,
          evaluated,
        } satisfies ShardProgressMessage);
      },
      () => cancelled,
    );

    if (cancelled) {
      self.postMessage({
        type: "done",
        id: msg.id,
        shardIndex: msg.shardIndex,
        cancelled: true,
        result: null,
      } satisfies ShardDoneMessage);
      return;
    }

    self.postMessage({
      type: "done",
      id: msg.id,
      shardIndex: msg.shardIndex,
      result,
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
  type: "runExactRange";
  id: string;
  shardIndex: number;
  pool: EmblemCandidate[];
  opts: SearchOptions;
  setBonuses: EmblemSetBonus[];
  groups: ColorGroup[];
  kVectors: number[][];
  kPrefix: number[];
  startGlobal: number;
  sliceSize: number;
  slots: number;
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
}

interface ShardDoneMessage {
  type: "done";
  id: string;
  shardIndex: number;
  result: ExactColorResult | null;
  cancelled?: boolean;
}

interface ShardErrorMessage {
  type: "error";
  id: string;
  shardIndex: number;
  message: string;
}
