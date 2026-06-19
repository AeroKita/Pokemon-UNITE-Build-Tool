/**

 * Emblem Search Web Worker entry point.

 *

 * Wraps the orchestrator so the heavy search runs off the main thread.

 * Vite 8 supports ESM workers natively; no vite.config changes needed.

 *

 * Message protocol:

 *   → { type: "run", id, pool, options, setBonuses, effort }

 *   → { type: "cancel", id }

 *   ← { type: "progress", id, pct, label, candidates?, totalCandidates? }

 *   ← { type: "done", id, result }

 *   ← { type: "error", id, message }

 */



import type { EmblemCandidate, SearchOptions, SearchResult } from "../engine/emblemSearch/types";

import type { EmblemSetBonus } from "../types";

import { runSearch } from "../engine/emblemSearch/orchestrator";

import { createWorkerJobState } from "./emblemSearchWorkerState";



const jobState = createWorkerJobState();



function postDone(jobId: string, result: SearchResult | null) {

  self.postMessage({ type: "done", id: jobId, result } satisfies WorkerDoneMessage);

}



self.onmessage = async (ev: MessageEvent) => {

  const msg = ev.data as WorkerMessage;



  if (msg.type === "cancel") {

    jobState.onCancel(msg.id);

    return;

  }



  if (msg.type !== "run") return;



  const { jobId, shouldAbort } = jobState.beginRun(msg.id);



  try {

    const result = await runSearch(

      {

        pool: msg.pool,

        options: msg.options,

        setBonuses: msg.setBonuses,

        effort: msg.effort,

        onProgress: (p) => {

          if (shouldAbort()) return;

          self.postMessage({

            type: "progress",

            id: jobId,

            pct: p.pct,

            label: p.label,

            candidates: p.candidates,

            totalCandidates: p.totalCandidates,

          } satisfies WorkerProgressMessage);

        },

      },

      shouldAbort,

    );



    if (shouldAbort()) {

      postDone(jobId, null);

      return;

    }



    if (jobState.wasCancelled(jobId)) {

      jobState.clearCancelled(jobId);

      postDone(jobId, null);

      return;

    }



    postDone(jobId, result);

  } catch (err) {

    if (shouldAbort()) {

      postDone(jobId, null);

      return;

    }

    self.postMessage({

      type: "error",

      id: jobId,

      message: err instanceof Error ? err.message : String(err),

    } satisfies WorkerErrorMessage);

  }

};



// ---------------------------------------------------------------------------

// Message type definitions

// ---------------------------------------------------------------------------



interface WorkerRunMessage {

  type: "run";

  id: string;

  pool: EmblemCandidate[];

  options: SearchOptions;

  setBonuses: EmblemSetBonus[];

  effort: "quick" | "normal" | "thorough";

}



interface WorkerCancelMessage {

  type: "cancel";

  id: string;

}



type WorkerMessage = WorkerRunMessage | WorkerCancelMessage;



interface WorkerProgressMessage {

  type: "progress";

  id: string;

  pct: number;

  label: string;

  candidates?: number;

  totalCandidates?: number;

}



interface WorkerDoneMessage {

  type: "done";

  id: string;

  result: SearchResult | null;

}



interface WorkerErrorMessage {

  type: "error";

  id: string;

  message: string;

}


