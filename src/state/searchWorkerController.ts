/**
 * Worker lifecycle controller for emblem search.
 *
 * Owns the (lazily created) search Worker and the in-flight job promise.
 *
 * Why this exists: the worker thread runs each search as a long synchronous
 * compute loop (heuristic budget loop / single-threaded exact enumeration)
 * that only yields microtasks — it never drains the macrotask queue mid-search.
 * That means a posted `{type:"cancel"}` message (and the next `{type:"run"}`)
 * sits queued and is NOT processed until the old search finishes — the UI is
 * stuck on "Starting…" until the page is refreshed.
 *
 * The only reliable interruption is `Worker.terminate()`, issued from the main
 * thread, which kills the worker thread immediately regardless of its
 * synchronous state (and tears down any nested shard workers it spawned). The
 * next `run()` lazily creates a fresh worker.
 *
 * This controller is framework-agnostic and accepts an injectable worker
 * factory so it can be unit-tested with a fake Worker in a non-DOM env.
 */

import type {
  EmblemCandidate,
  SearchOptions,
  SearchResult,
} from "../engine/emblemSearch/types";
import type { EmblemSetBonus } from "../types";

export interface WorkerRunPayload {
  pool: EmblemCandidate[];
  options: SearchOptions;
  setBonuses: EmblemSetBonus[];
  effort: "quick" | "normal" | "thorough";
}

export interface WorkerProgress {
  pct: number;
  label: string;
  candidates?: number;
  totalCandidates?: number;
}

interface PendingJob {
  id: string;
  resolve: (result: SearchResult | null) => void;
  reject: (error: Error) => void;
}

/** Minimal subset of the Worker interface this controller relies on. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  addEventListener(type: "message", listener: (ev: { data: unknown }) => void): void;
  addEventListener(type: "error", listener: (ev: { message?: string }) => void): void;
}

let jobSerial = 0;
function newJobId(): string {
  return `job-${++jobSerial}`;
}

export class SearchWorkerController {
  private worker: WorkerLike | null = null;
  private handlersAttached = false;
  private pending: PendingJob | null = null;

  constructor(private readonly createWorker: () => WorkerLike | null) {}

  /** True once a worker instance exists (and hasn't been terminated). */
  hasWorker(): boolean {
    return this.worker !== null;
  }

  /**
   * Start a search in the worker. Lazily creates a worker if none exists
   * (including after a prior terminate()). The progress callback only fires
   * for messages belonging to this job. Rejects if the worker is unavailable.
   */
  run(
    payload: WorkerRunPayload,
    onProgress: (progress: WorkerProgress) => void,
  ): Promise<SearchResult | null> {
    return new Promise((resolve, reject) => {
      // Clear any stray pending await from a previous (errored/completed) job.
      this.settlePending(null);

      if (!this.worker) {
        const created = this.createWorker();
        if (!created) { reject(new Error("Worker unavailable")); return; }
        this.worker = created;
      }
      this.attachHandlers(this.worker, onProgress);

      const id = newJobId();
      this.pending = { id, resolve, reject };

      this.worker.postMessage({ type: "run", id, ...payload });
    });
  }

  /**
   * Forcibly terminate the worker and resolve any in-flight job with null.
   * The next run() spawns a fresh worker. This is the guaranteed interruption
   * for a worker stuck in a long synchronous search.
   */
  terminate(): void {
    if (this.worker) {
      try { this.worker.terminate(); } catch { /* already gone */ }
    }
    this.worker = null;
    this.handlersAttached = false;
    this.settlePending(null);
  }

  private settlePending(result: SearchResult | null): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    pending.resolve(result);
  }

  private attachHandlers(
    worker: WorkerLike,
    onProgress: (progress: WorkerProgress) => void,
  ): void {
    // Re-bind the progress callback for the latest run; handlers attach once
    // per worker instance.
    this.progressCallback = onProgress;
    if (this.handlersAttached) return;

    worker.addEventListener("message", (ev: { data: unknown }) => {
      const msg = ev.data as
        | { type: "progress"; id: string; pct: number; label: string; candidates?: number; totalCandidates?: number }
        | { type: "done"; id: string; result: SearchResult | null }
        | { type: "error"; id: string; message: string };
      const pending = this.pending;
      if (!pending || msg.id !== pending.id) return;

      if (msg.type === "progress") {
        this.progressCallback?.({
          pct: msg.pct,
          label: msg.label,
          candidates: msg.candidates,
          totalCandidates: msg.totalCandidates,
        });
      } else if (msg.type === "done") {
        this.pending = null;
        pending.resolve(msg.result);
      } else if (msg.type === "error") {
        this.pending = null;
        pending.reject(new Error(msg.message));
      }
    });

    worker.addEventListener("error", (ev: { message?: string }) => {
      const pending = this.pending;
      if (!pending) return;
      this.pending = null;
      pending.reject(new Error(ev.message ?? "Worker error"));
    });

    this.handlersAttached = true;
  }

  private progressCallback: ((progress: WorkerProgress) => void) | null = null;
}
