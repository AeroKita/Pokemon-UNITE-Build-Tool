/**
 * EmblemSearch session state — manages in-progress search, cancellation,
 * and result for use by the EmblemOptimizer UI.
 *
 * Tries to run in a Web Worker for off-thread execution.
 * Falls back to main-thread execution if Worker construction fails
 * (e.g. in test environments, old browsers, or Tauri strict CSP).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EmblemCandidate,
  SearchMode,
  SearchOptions,
  SearchProgress,
  SearchResult,
} from "../engine/emblemSearch/types";
import type { EmblemColor, EmblemGrade, EmblemSetBonus } from "../types";
import { runSearch } from "../engine/emblemSearch/orchestrator";
import { computeSearchEta } from "../ui/formatEta";
import { SearchWorkerController } from "./searchWorkerController";

export type SearchStatus = "idle" | "running" | "done" | "error" | "cancelled";

export interface EmblemSearchState {
  status: SearchStatus;
  progress: SearchProgress | null;
  /** Estimated time remaining during an active search, e.g. "~12s remaining". */
  eta: string | null;
  result: SearchResult | null;
  errorMsg: string | null;
}

export interface UseEmblemSearchReturn {
  state: EmblemSearchState;
  run: (
    pool: EmblemCandidate[],
    options: SearchOptions,
    setBonuses: EmblemSetBonus[],
    effort: "quick" | "normal" | "thorough",
  ) => Promise<void>;
  cancel: () => void;
  reset: () => void;
  /** Clear a cached/stale result without cancelling an in-progress search. */
  clearResult: () => void;
}

/** Serializable snapshot of optimizer controls that affect search output. */
export interface EmblemSearchSettingsSnapshot {
  pokemonId: string | null;
  optimizeLevel: number;
  basicUseOwned: boolean;
  useOwned: boolean;
  mixedGrades: boolean;
  allowedGrades: EmblemGrade[];
  basicEffort: string;
  effort: string;
  colorBonuses: boolean;
  pokemonAwareScoring: boolean;
  exactCap: number;
  mode: SearchMode;
  customWeights: Record<string, number>;
  targetValues: Record<string, string>;
  targetActive: Record<string, boolean>;
  floorValues: Record<string, string>;
  floorActive: Record<string, boolean>;
  colorMode: string;
  activeColors: EmblemColor[];
  colorCounts: Record<string, number>;
  /** Owned emblem keys (`id:grade`) when pool is restricted to owned emblems. */
  ownedKeys: string[];
}

/** Stable key for comparing search-relevant settings (excludes Basic/Advanced toggle). */
export function buildSearchSettingsKey(snapshot: EmblemSearchSettingsSnapshot): string {
  return JSON.stringify(snapshot);
}

const INITIAL: EmblemSearchState = {
  status: "idle",
  progress: null,
  eta: null,
  result: null,
  errorMsg: null,
};

/** Last completed search result — survives Optimize tab unmount/remount. */
interface EmblemSearchSession {
  state: EmblemSearchState;
  /** Settings fingerprint that produced `state` (see buildSearchSettingsKey). */
  settingsKey: string | null;
}

let sessionCache: EmblemSearchSession | null = null;

function readSessionCache(): EmblemSearchState | null {
  const cached = sessionCache?.state;
  if (cached?.status === "done" && cached.result) return cached;
  return null;
}

/** Settings key stored alongside the last cached result, if any. */
export function getSessionSearchSettingsKey(): string | null {
  return sessionCache?.settingsKey ?? null;
}

function persistSessionCache(state: EmblemSearchState): void {
  if (state.status === "done" && state.result) {
    sessionCache = { state, settingsKey: sessionCache?.settingsKey ?? null };
  } else if (state.status === "idle" && !state.result) {
    sessionCache = null;
  }
}

/** Record the settings fingerprint for the current cached result. */
export function persistSessionSearchSettings(settingsKey: string): void {
  if (sessionCache?.state.status === "done" && sessionCache.state.result) {
    sessionCache = { ...sessionCache, settingsKey };
  }
}

/**
 * Tracks which search invocation is current. Stale async completions (e.g. after
 * cancel + immediate re-run) must not overwrite state or apply the wrong effort.
 */
export class SearchRunCoordinator {
  private generation = 0;

  /** Start a new run; invalidates any in-flight run. Returns token for this run. */
  begin(): number {
    return ++this.generation;
  }

  /** Invalidate the current run (user cancelled). */
  cancel(): void {
    this.generation++;
  }

  isCurrent(token: number): boolean {
    return token === this.generation;
  }
}

/** Test helper — reset module-level session cache between cases. */
export function resetEmblemSearchSession(): void {
  sessionCache = null;
}

/** Test helper — seed session cache as if a search had completed. */
export function seedEmblemSearchSession(
  state: EmblemSearchState,
  settingsKey: string | null = null,
): void {
  if (state.status === "done" && state.result) {
    sessionCache = { state, settingsKey };
  }
}

/** Test helper — read cached search state. */
export function getEmblemSearchSessionState(): EmblemSearchState | null {
  return readSessionCache();
}

// ---------------------------------------------------------------------------
// Worker helpers
// ---------------------------------------------------------------------------

/** Lazily create the worker; returns null if workers aren't supported. */
function tryCreateWorker(): Worker | null {
  try {
    return new Worker(
      new URL("../workers/emblemSearch.worker.ts", import.meta.url),
      { type: "module" },
    );
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * React hook managing emblem search lifecycle (start / cancel / reset).
 *
 * Prefers running in a Web Worker so the UI stays responsive. Falls back to
 * main-thread execution (same orchestrator) when the Worker cannot be created.
 */
export function useEmblemSearch(): UseEmblemSearchReturn {
  const [state, setState] = useState<EmblemSearchState>(() => readSessionCache() ?? INITIAL);
  const abortRef = useRef(false);
  const runningRef = useRef(false);
  const runCoordinatorRef = useRef(new SearchRunCoordinator());
  const workerControllerRef = useRef<SearchWorkerController | null>(null);

  // ETA tracking — reset when a new search begins.
  const searchStartTimeRef = useRef<number>(0);
  const etaSmoothedRef = useRef<number | null>(null);

  function getWorkerController(): SearchWorkerController {
    if (!workerControllerRef.current) {
      workerControllerRef.current = new SearchWorkerController(tryCreateWorker);
    }
    return workerControllerRef.current;
  }

  /**
   * Forcibly tear down the worker. Posting a "cancel" message is NOT enough:
   * the worker thread runs the search as a long synchronous compute loop
   * (heuristic budget loop / single-threaded exact enumeration) that only
   * yields microtasks, never draining the macrotask queue — so a queued
   * `cancel` (and the next `run`) is never processed until the old search
   * finishes (effectively "Starting…" forever on a long search).
   *
   * terminate() is issued from the main thread and kills the worker thread
   * immediately regardless of its synchronous state. It also tears down any
   * nested shard workers spawned by exactParallel (Chromium terminates a
   * worker's owned child workers when the parent is terminated), so no
   * orphaned shard workers keep grinding. The next run() lazily spawns a
   * fresh worker.
   */
  const terminateWorker = useCallback(() => {
    workerControllerRef.current?.terminate();
  }, []);

  const cancel = useCallback(() => {
    runCoordinatorRef.current.cancel();
    abortRef.current = true;
    runningRef.current = false;
    terminateWorker();
    setState((s) =>
      s.status === "running"
        ? { status: "idle", progress: null, eta: null, result: s.result, errorMsg: null }
        : s,
    );
  }, [terminateWorker]);

  const reset = useCallback(() => {
    runCoordinatorRef.current.cancel();
    abortRef.current = true;
    runningRef.current = false;
    terminateWorker();
    sessionCache = null;
    setState(INITIAL);
  }, [terminateWorker]);

  // Tear down the worker (and any nested shard workers) when the hook unmounts
  // so a backgrounded long search doesn't leak a grinding worker thread.
  useEffect(() => () => { terminateWorker(); }, [terminateWorker]);

  const clearResult = useCallback(() => {
    if (runningRef.current) return;
    sessionCache = null;
    setState((s) => {
      if (!s.result && s.status === "idle") return s;
      return { status: "idle", progress: null, eta: null, result: null, errorMsg: null };
    });
  }, []);

  /** Run in a Worker; rejects if Worker fails. */
  function runInWorker(
    pool: EmblemCandidate[],
    options: SearchOptions,
    setBonuses: EmblemSetBonus[],
    effort: "quick" | "normal" | "thorough",
    runToken: number,
  ): Promise<SearchResult | null> {
    return getWorkerController().run(
      { pool, options, setBonuses, effort },
      (progress) => {
        if (!runCoordinatorRef.current.isCurrent(runToken)) return;
        const eta = computeSearchEta(progress.pct, searchStartTimeRef.current, etaSmoothedRef);
        setState((s) =>
          s.status === "running"
            ? { ...s, progress: { pct: progress.pct, label: progress.label, candidates: progress.candidates, totalCandidates: progress.totalCandidates }, eta }
            : s,
        );
      },
    );
  }

  /** Run on main thread (fallback). */
  async function runOnMainThread(
    pool: EmblemCandidate[],
    options: SearchOptions,
    setBonuses: EmblemSetBonus[],
    effort: "quick" | "normal" | "thorough",
    runToken: number,
  ): Promise<SearchResult | null> {
    return runSearch(
      {
        pool,
        options,
        setBonuses,
        effort,
        onProgress: (p) => {
          if (!runCoordinatorRef.current.isCurrent(runToken)) return;
          const eta = computeSearchEta(p.pct, searchStartTimeRef.current, etaSmoothedRef);
          setState((s) =>
            s.status === "running" ? { ...s, progress: p, eta } : s,
          );
        },
      },
      () => !runCoordinatorRef.current.isCurrent(runToken) || abortRef.current,
    );
  }

  const run = useCallback(
    async (
      pool: EmblemCandidate[],
      options: SearchOptions,
      setBonuses: EmblemSetBonus[],
      effort: "quick" | "normal" | "thorough",
    ) => {
      if (runningRef.current) return;

      const runToken = runCoordinatorRef.current.begin();
      abortRef.current = false;

      runningRef.current = true;

      // Reset ETA tracking for this new search.
      searchStartTimeRef.current = Date.now();
      etaSmoothedRef.current = null;

      sessionCache = null;
      setState({ status: "running", progress: { pct: 0, label: "Starting…" }, eta: null, result: null, errorMsg: null });

      try {
        // Prefer Worker; fall back to main thread
        let result: SearchResult | null;
        try {
          result = await runInWorker(pool, options, setBonuses, effort, runToken);
        } catch {
          // Worker failed (unsupported env, Tauri CSP, test) → main thread
          result = await runOnMainThread(pool, options, setBonuses, effort, runToken);
        }

        if (!runCoordinatorRef.current.isCurrent(runToken)) return;

        if (abortRef.current) {
          setState((s) => ({ ...s, status: "cancelled", eta: null }));
          return;
        }

        setState(() => {
          const next: EmblemSearchState = {
            status: "done",
            progress: result
              ? { pct: 100, label: `Done · ${result.candidates.toLocaleString()} candidates · ${(result.totalMs / 1000).toFixed(1)}s` }
              : { pct: 100, label: "No result found" },
            eta: null,
            result,
            errorMsg: null,
          };
          persistSessionCache(next);
          return next;
        });
      } catch (err) {
        if (!runCoordinatorRef.current.isCurrent(runToken)) return;
        setState({
          status: "error",
          progress: null,
          eta: null,
          result: null,
          errorMsg: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (runCoordinatorRef.current.isCurrent(runToken)) {
          runningRef.current = false;
        }
      }
    },
    [],
  );

  return { state, run, cancel, reset, clearResult };
}
