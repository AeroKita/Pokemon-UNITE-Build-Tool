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

/** Heuristic-only: how many independent search runs to generate per click. */
export const RESULT_COUNT_MIN = 1;
/** Soft cap — prevents accidental huge batches; not shown in UI. */
export const RESULT_COUNT_MAX = 99;
export const DEFAULT_RESULT_COUNT = 1;

export function clampResultCount(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_RESULT_COUNT;
  return Math.min(RESULT_COUNT_MAX, Math.max(RESULT_COUNT_MIN, Math.floor(n)));
}

/** Map a single-run progress snapshot onto a multi-run batch (1-based run index). */
export function mapMultiRunProgress(
  runIndex: number,
  totalRuns: number,
  inner: SearchProgress,
): SearchProgress {
  if (totalRuns <= 1) return inner;
  const i = runIndex - 1;
  const pct = Math.min(100, (i / totalRuns) * 100 + (inner.pct / 100) * (100 / totalRuns));
  const batchLabel = inner.label.startsWith("Smart search")
    ? inner.label.replace(/^Smart search/, `Smart search ${runIndex}/${totalRuns}`)
    : `Smart search ${runIndex}/${totalRuns}…`;
  return {
    pct,
    label: batchLabel,
    candidates: inner.candidates,
    totalCandidates: inner.totalCandidates,
  };
}

/**
 * Append completed runs to history; returns the index the UI should show.
 * First search (empty history) shows Build 1 (index 0). Later appends preserve
 * the user's current viewing position so new builds do not auto-jump focus.
 */
export function appendSearchHistoryEntries(
  history: SearchHistoryEntry[],
  entries: SearchHistoryEntry[],
  currentHistoryIndex: number = -1,
): { history: SearchHistoryEntry[]; historyIndex: number } {
  if (entries.length === 0) {
    return { history, historyIndex: -1 };
  }
  const next = [...history, ...entries];
  if (history.length === 0) {
    return { history: next, historyIndex: 0 };
  }
  const historyIndex =
    currentHistoryIndex >= 0 && currentHistoryIndex < next.length
      ? currentHistoryIndex
      : Math.max(0, history.length - 1);
  return { history: next, historyIndex };
}

/** One completed search kept in session-scoped result history. */
export interface SearchHistoryEntry {
  result: SearchResult;
  settingsKey: string;
}

export interface EmblemSearchState {
  status: SearchStatus;
  progress: SearchProgress | null;
  /** Estimated time remaining during an active search, e.g. "~12s remaining". */
  eta: string | null;
  /** Currently viewed result (mirrors history[historyIndex] when history is non-empty). */
  result: SearchResult | null;
  errorMsg: string | null;
  /** Session-scoped stack of completed searches for the current Pokémon. */
  history: SearchHistoryEntry[];
  /** Index into `history` for the result currently shown in the UI. */
  historyIndex: number;
}

export interface UseEmblemSearchReturn {
  state: EmblemSearchState;
  run: (
    pool: EmblemCandidate[],
    options: SearchOptions,
    setBonuses: EmblemSetBonus[],
    effort: "quick" | "normal" | "thorough",
    settingsKey: string,
    resultCount?: number,
  ) => Promise<void>;
  cancel: () => void;
  reset: () => void;
  /** Clear cached results and history without cancelling an in-progress search. */
  clearResult: () => void;
  /** Step through prior search generations (‹ / › in the results UI). */
  goHistory: (delta: number) => void;
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
  /** Heuristic-only: variations requested per search click (exact mode always uses 1). */
  resultCount: number;
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
  history: [],
  historyIndex: -1,
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

function settingsKeyForState(state: EmblemSearchState): string | null {
  if (state.historyIndex >= 0 && state.history[state.historyIndex]) {
    return state.history[state.historyIndex].settingsKey;
  }
  return sessionCache?.settingsKey ?? null;
}

/** Settings key stored alongside the currently viewed cached result, if any. */
export function getSessionSearchSettingsKey(): string | null {
  if (!sessionCache) return null;
  return settingsKeyForState(sessionCache.state);
}

function persistSessionCache(state: EmblemSearchState): void {
  if (state.status === "done" && state.result) {
    sessionCache = { state, settingsKey: settingsKeyForState(state) };
  } else if (state.status === "idle" && !state.result && state.history.length === 0) {
    sessionCache = null;
  }
}

/** Record the settings fingerprint for the currently viewed cached result. */
export function persistSessionSearchSettings(settingsKey: string): void {
  if (sessionCache?.state.status !== "done" || !sessionCache.state.result) return;
  const s = sessionCache.state;
  if (s.historyIndex >= 0 && s.history[s.historyIndex]) {
    const history = s.history.map((entry, i) =>
      i === s.historyIndex ? { ...entry, settingsKey } : entry,
    );
    sessionCache = {
      ...sessionCache,
      state: { ...s, history },
      settingsKey,
    };
  } else {
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
    const key = settingsKey ?? "";
    const history =
      state.history.length > 0 ? state.history : [{ result: state.result, settingsKey: key }];
    const historyIndex = state.historyIndex >= 0 ? state.historyIndex : 0;
    const fullState: EmblemSearchState = { ...state, history, historyIndex };
    sessionCache = { state: fullState, settingsKey: settingsKeyForState(fullState) };
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
    return new Worker(new URL("../workers/emblemSearch.worker.ts", import.meta.url), {
      type: "module",
    });
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
    setState((s) => {
      if (s.status !== "running") return s;
      const prev = s.historyIndex >= 0 ? s.history[s.historyIndex] : null;
      const next: EmblemSearchState = {
        status: prev ? "done" : "idle",
        progress: null,
        eta: null,
        result: prev?.result ?? null,
        errorMsg: null,
        history: s.history,
        historyIndex: s.historyIndex,
      };
      if (next.status === "done" && next.result) persistSessionCache(next);
      return next;
    });
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
  useEffect(
    () => () => {
      terminateWorker();
    },
    [terminateWorker],
  );

  const clearResult = useCallback(() => {
    if (runningRef.current) return;
    sessionCache = null;
    setState((s) => {
      if (!s.result && s.status === "idle" && s.history.length === 0) return s;
      return { ...INITIAL };
    });
  }, []);

  const goHistory = useCallback((delta: number) => {
    setState((s) => {
      if (s.history.length < 2) return s;
      const nextIndex = s.historyIndex + delta;
      if (nextIndex < 0 || nextIndex >= s.history.length) return s;
      const entry = s.history[nextIndex];
      const next: EmblemSearchState = {
        ...s,
        status: "done",
        historyIndex: nextIndex,
        result: entry.result,
        errorMsg: null,
      };
      persistSessionCache(next);
      return next;
    });
  }, []);

  /** Run in a Worker; rejects if Worker fails. */
  function runInWorker(
    pool: EmblemCandidate[],
    options: SearchOptions,
    setBonuses: EmblemSetBonus[],
    effort: "quick" | "normal" | "thorough",
    runToken: number,
    runIndex: number,
    totalRuns: number,
  ): Promise<SearchResult | null> {
    return getWorkerController().run({ pool, options, setBonuses, effort }, (progress) => {
      reportProgress(runToken, runIndex, totalRuns, {
        pct: progress.pct,
        label: progress.label,
        candidates: progress.candidates,
        totalCandidates: progress.totalCandidates,
      });
    });
  }

  function reportProgress(
    runToken: number,
    runIndex: number,
    totalRuns: number,
    inner: SearchProgress,
  ) {
    if (!runCoordinatorRef.current.isCurrent(runToken)) return;
    const progress = mapMultiRunProgress(runIndex, totalRuns, inner);
    const eta = computeSearchEta(progress.pct, searchStartTimeRef.current, etaSmoothedRef);
    setState((s) => (s.status === "running" ? { ...s, progress, eta } : s));
  }

  /** Run on main thread (fallback). */
  async function runOnMainThread(
    pool: EmblemCandidate[],
    options: SearchOptions,
    setBonuses: EmblemSetBonus[],
    effort: "quick" | "normal" | "thorough",
    runToken: number,
    runIndex: number,
    totalRuns: number,
  ): Promise<SearchResult | null> {
    return runSearch(
      {
        pool,
        options,
        setBonuses,
        effort,
        onProgress: (p) => reportProgress(runToken, runIndex, totalRuns, p),
      },
      () => !runCoordinatorRef.current.isCurrent(runToken) || abortRef.current,
    );
  }

  async function runSingleSearch(
    pool: EmblemCandidate[],
    options: SearchOptions,
    setBonuses: EmblemSetBonus[],
    effort: "quick" | "normal" | "thorough",
    runToken: number,
    runIndex: number,
    totalRuns: number,
  ): Promise<SearchResult | null> {
    try {
      return await runInWorker(pool, options, setBonuses, effort, runToken, runIndex, totalRuns);
    } catch {
      return runOnMainThread(pool, options, setBonuses, effort, runToken, runIndex, totalRuns);
    }
  }

  const run = useCallback(
    async (
      pool: EmblemCandidate[],
      options: SearchOptions,
      setBonuses: EmblemSetBonus[],
      effort: "quick" | "normal" | "thorough",
      settingsKey: string,
      resultCount: number = DEFAULT_RESULT_COUNT,
    ) => {
      if (runningRef.current) return;

      const runToken = runCoordinatorRef.current.begin();
      abortRef.current = false;
      const totalRuns = clampResultCount(resultCount);

      runningRef.current = true;

      // Reset ETA tracking for this new search.
      searchStartTimeRef.current = Date.now();
      etaSmoothedRef.current = null;

      const startLabel = totalRuns > 1 ? `Smart search 1/${totalRuns}…` : "Starting…";

      setState((s) => ({
        status: "running",
        progress: { pct: 0, label: startLabel },
        eta: null,
        result: null,
        errorMsg: null,
        history: s.history,
        historyIndex: s.historyIndex,
      }));

      try {
        const batchEntries: SearchHistoryEntry[] = [];

        for (let i = 0; i < totalRuns; i++) {
          if (!runCoordinatorRef.current.isCurrent(runToken)) return;
          if (abortRef.current) break;

          const runIndex = i + 1;
          const result = await runSingleSearch(
            pool,
            options,
            setBonuses,
            effort,
            runToken,
            runIndex,
            totalRuns,
          );

          if (!runCoordinatorRef.current.isCurrent(runToken)) return;
          if (abortRef.current) break;

          if (result != null) {
            batchEntries.push({ result, settingsKey });
            // Exact search is deterministic — never run additional heuristic passes.
            if (result.exact) break;
          }
        }

        if (!runCoordinatorRef.current.isCurrent(runToken)) return;

        if (abortRef.current) {
          setState((s) => {
            const { history, historyIndex: appendedIndex } = appendSearchHistoryEntries(
              s.history,
              batchEntries,
              s.historyIndex,
            );
            const historyIndex =
              appendedIndex >= 0 ? appendedIndex : s.historyIndex >= 0 ? s.historyIndex : 0;
            const viewedResult = historyIndex >= 0 ? (history[historyIndex]?.result ?? null) : null;
            const next: EmblemSearchState = {
              status: viewedResult ? "done" : "cancelled",
              progress: null,
              eta: null,
              result: viewedResult,
              errorMsg: null,
              history,
              historyIndex,
            };
            if (viewedResult) persistSessionCache(next);
            return next;
          });
          return;
        }

        setState((s) => {
          const { history, historyIndex: appendedIndex } = appendSearchHistoryEntries(
            s.history,
            batchEntries,
            s.historyIndex,
          );
          const historyIndex =
            appendedIndex >= 0 ? appendedIndex : s.historyIndex >= 0 ? s.historyIndex : 0;
          const viewedResult =
            historyIndex >= 0
              ? (history[historyIndex]?.result ?? null)
              : s.historyIndex >= 0
                ? (s.history[s.historyIndex]?.result ?? null)
                : null;

          const lastBatchResult =
            batchEntries.length > 0
              ? (batchEntries[batchEntries.length - 1]?.result ?? null)
              : null;

          const doneLabel =
            batchEntries.length > 1
              ? `Done · ${batchEntries.length} variations`
              : lastBatchResult
                ? `Done · ${lastBatchResult.candidates.toLocaleString()} candidates · ${(lastBatchResult.totalMs / 1000).toFixed(1)}s`
                : "No result found";

          const next: EmblemSearchState = {
            status: "done",
            progress: { pct: 100, label: doneLabel },
            eta: null,
            result: viewedResult,
            errorMsg: null,
            history,
            historyIndex,
          };
          if (viewedResult) persistSessionCache(next);
          return next;
        });
      } catch (err) {
        if (!runCoordinatorRef.current.isCurrent(runToken)) return;
        setState((s) => ({
          status: "error",
          progress: null,
          eta: null,
          result: s.historyIndex >= 0 ? (s.history[s.historyIndex]?.result ?? null) : null,
          errorMsg: err instanceof Error ? err.message : String(err),
          history: s.history,
          historyIndex: s.historyIndex,
        }));
      } finally {
        if (runCoordinatorRef.current.isCurrent(runToken)) {
          runningRef.current = false;
        }
      }
    },
    [],
  );

  return { state, run, cancel, reset, clearResult, goHistory };
}
