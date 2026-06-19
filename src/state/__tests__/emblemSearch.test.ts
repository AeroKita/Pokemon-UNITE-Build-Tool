import { describe, it, expect, beforeEach } from "vitest";
import type { SearchResult } from "../../engine/emblemSearch/types";
import {
  appendSearchHistoryEntries,
  buildSearchSettingsKey,
  clampResultCount,
  getEmblemSearchSessionState,
  getSessionSearchSettingsKey,
  mapMultiRunProgress,
  persistSessionSearchSettings,
  resetEmblemSearchSession,
  SearchRunCoordinator,
  seedEmblemSearchSession,
  type EmblemSearchSettingsSnapshot,
  type EmblemSearchState,
} from "../emblemSearch";

interface PendingWorkerJob {
  id: string;
  runToken: number;
  resolve: (result: SearchResult | null) => void;
  reject: (error: Error) => void;
}

/** Mirrors hook logic: cancel must release a hung worker await before rerun. */
function simulateCancelThenRerun(
  coordinator: SearchRunCoordinator,
  pending: PendingWorkerJob | null,
  releasePending: (result: SearchResult | null) => PendingWorkerJob | null,
) {
  const firstToken = pending?.runToken ?? coordinator.begin();
  coordinator.cancel();
  releasePending(null);

  const secondToken = coordinator.begin();
  return {
    firstToken,
    secondToken,
    firstStillCurrent: coordinator.isCurrent(firstToken),
    secondCurrent: coordinator.isCurrent(secondToken),
  };
}

const BASE: EmblemSearchSettingsSnapshot = {
  pokemonId: "pikachu",
  optimizeLevel: 15,
  basicUseOwned: true,
  useOwned: false,
  mixedGrades: true,
  allowedGrades: ["bronze", "gold", "silver"],
  basicEffort: "normal",
  effort: "normal",
  colorBonuses: true,
  pokemonAwareScoring: true,
  exactCap: 1_000_000_000,
  mode: "maximize",
  customWeights: {},
  targetValues: {},
  targetActive: {},
  floorValues: {},
  floorActive: {},
  colorMode: "off",
  activeColors: [],
  colorCounts: {},
  ownedKeys: ["001-bulbasaur:gold"],
  resultCount: 1,
};

const MOCK_RESULT = {
  picks: [{ emblem: { id: "001-bulbasaur" }, grade: "gold" as const }],
  score: 42,
  candidates: 100,
  totalMs: 500,
  phase: "heuristic",
} as SearchResult;

const DONE_STATE: EmblemSearchState = {
  status: "done",
  progress: { pct: 100, label: "Done" },
  eta: null,
  result: MOCK_RESULT,
  errorMsg: null,
  history: [{ result: MOCK_RESULT, settingsKey: "test-key" }],
  historyIndex: 0,
};

describe("buildSearchSettingsKey", () => {
  beforeEach(() => {
    resetEmblemSearchSession();
  });

  it("is stable for identical snapshots", () => {
    const a = buildSearchSettingsKey(BASE);
    const b = buildSearchSettingsKey({ ...BASE });
    expect(a).toBe(b);
  });

  it("changes when a search-relevant field changes", () => {
    const base = buildSearchSettingsKey(BASE);
    expect(buildSearchSettingsKey({ ...BASE, optimizeLevel: 10 })).not.toBe(base);
    expect(buildSearchSettingsKey({ ...BASE, basicUseOwned: false })).not.toBe(base);
    expect(buildSearchSettingsKey({ ...BASE, effort: "thorough" })).not.toBe(base);
    expect(buildSearchSettingsKey({ ...BASE, mode: "target" })).not.toBe(base);
    expect(buildSearchSettingsKey({ ...BASE, ownedKeys: ["002-ivysaur:silver"] })).not.toBe(base);
    expect(buildSearchSettingsKey({ ...BASE, resultCount: 3 })).not.toBe(base);
  });
});

describe("multi-result helpers", () => {
  it("clampResultCount bounds to 1–99", () => {
    expect(clampResultCount(0)).toBe(1);
    expect(clampResultCount(3)).toBe(3);
    expect(clampResultCount(99)).toBe(99);
    expect(clampResultCount(100)).toBe(99);
    expect(clampResultCount(Number.NaN)).toBe(1);
  });

  it("mapMultiRunProgress prefixes batch index for smart search", () => {
    const mapped = mapMultiRunProgress(2, 5, { pct: 50, label: "Smart search…" });
    expect(mapped.label).toBe("Smart search 2/5…");
    expect(mapped.pct).toBeGreaterThan(20);
    expect(mapped.pct).toBeLessThan(40);
  });

  it("appendSearchHistoryEntries shows first build on initial search", () => {
    const key = buildSearchSettingsKey(BASE);
    const first = { ...MOCK_RESULT, score: 1 };

    const initial = appendSearchHistoryEntries([], [{ result: first, settingsKey: key }]);
    expect(initial.history).toHaveLength(1);
    expect(initial.historyIndex).toBe(0);
    expect(initial.history[0]?.result.score).toBe(1);
  });

  it("appendSearchHistoryEntries preserves index on append", () => {
    const key = buildSearchSettingsKey(BASE);
    const first = { ...MOCK_RESULT, score: 1 };
    const second = { ...MOCK_RESULT, score: 2 };

    const initial = appendSearchHistoryEntries([], [{ result: first, settingsKey: key }]);
    const sequential = appendSearchHistoryEntries(
      initial.history,
      [{ result: second, settingsKey: key }],
      initial.historyIndex,
    );
    expect(sequential.history).toHaveLength(2);
    expect(sequential.historyIndex).toBe(0);
    expect(sequential.history[sequential.historyIndex]?.result.score).toBe(1);
    expect(sequential.history[1]?.result.score).toBe(2);
  });

  it("appendSearchHistoryEntries preserves index on multi-entry batch", () => {
    const key = buildSearchSettingsKey(BASE);
    const prior = [
      { result: { ...MOCK_RESULT, score: 1 }, settingsKey: key },
      { result: { ...MOCK_RESULT, score: 2 }, settingsKey: key },
    ];
    const batchEntries = [
      { result: { ...MOCK_RESULT, score: 3 }, settingsKey: key },
      { result: { ...MOCK_RESULT, score: 4 }, settingsKey: key },
    ];

    const fresh = appendSearchHistoryEntries([], batchEntries);
    expect(fresh.history).toHaveLength(2);
    expect(fresh.historyIndex).toBe(0);
    expect(fresh.history[fresh.historyIndex]?.result.score).toBe(3);

    const preserved = appendSearchHistoryEntries(prior, batchEntries, 1);
    expect(preserved.history).toHaveLength(4);
    expect(preserved.historyIndex).toBe(1);
    expect(preserved.history[preserved.historyIndex]?.result.score).toBe(2);
  });
});

describe("session cache", () => {
  beforeEach(() => {
    resetEmblemSearchSession();
  });

  it("stores and reads a completed search result with history", () => {
    const key = buildSearchSettingsKey(BASE);
    const state: EmblemSearchState = {
      ...DONE_STATE,
      history: [{ result: MOCK_RESULT, settingsKey: key }],
    };
    seedEmblemSearchSession(state, key);

    expect(getEmblemSearchSessionState()).toEqual(state);
    expect(getSessionSearchSettingsKey()).toBe(key);
  });

  it("updates the settings fingerprint for the viewed history entry", () => {
    seedEmblemSearchSession(DONE_STATE, "initial");
    const key = buildSearchSettingsKey({ ...BASE, effort: "thorough" });

    persistSessionSearchSettings(key);

    expect(getSessionSearchSettingsKey()).toBe(key);
    expect(getEmblemSearchSessionState()?.history[0]?.settingsKey).toBe(key);
    expect(getEmblemSearchSessionState()?.result).toBe(MOCK_RESULT);
  });

  it("simulated remount baseline uses cached history entry key", () => {
    const searchKey = buildSearchSettingsKey({ ...BASE, effort: "thorough", basicUseOwned: false });
    const remountDefaultsKey = buildSearchSettingsKey(BASE);
    const state: EmblemSearchState = {
      ...DONE_STATE,
      history: [{ result: MOCK_RESULT, settingsKey: searchKey }],
    };

    seedEmblemSearchSession(state, searchKey);

    const remountBaseline = getSessionSearchSettingsKey() ?? remountDefaultsKey;
    expect(remountBaseline).toBe(searchKey);
    expect(remountBaseline).not.toBe(remountDefaultsKey);
  });

  it("seeds legacy single-result state into a one-entry history stack", () => {
    const key = buildSearchSettingsKey(BASE);
    const legacy: EmblemSearchState = {
      status: "done",
      progress: { pct: 100, label: "Done" },
      eta: null,
      result: MOCK_RESULT,
      errorMsg: null,
      history: [],
      historyIndex: -1,
    };
    seedEmblemSearchSession(legacy, key);

    const cached = getEmblemSearchSessionState();
    expect(cached?.history).toHaveLength(1);
    expect(cached?.history[0]?.settingsKey).toBe(key);
    expect(cached?.historyIndex).toBe(0);
  });

  it("clears session on reset", () => {
    seedEmblemSearchSession(DONE_STATE, buildSearchSettingsKey(BASE));
    resetEmblemSearchSession();
    expect(getEmblemSearchSessionState()).toBeNull();
    expect(getSessionSearchSettingsKey()).toBeNull();
  });
});

describe("SearchRunCoordinator", () => {
  it("invalidates a run after cancel so stale completions are ignored", () => {
    const coordinator = new SearchRunCoordinator();
    const first = coordinator.begin();
    expect(coordinator.isCurrent(first)).toBe(true);

    coordinator.cancel();
    expect(coordinator.isCurrent(first)).toBe(false);
  });

  it("invalidates prior runs when a new run begins", () => {
    const coordinator = new SearchRunCoordinator();
    const first = coordinator.begin();
    const second = coordinator.begin();

    expect(coordinator.isCurrent(first)).toBe(false);
    expect(coordinator.isCurrent(second)).toBe(true);
  });

  it("cancel then begin yields a fresh token for the replacement run", () => {
    const coordinator = new SearchRunCoordinator();
    const cancelled = coordinator.begin();
    coordinator.cancel();
    const replacement = coordinator.begin();

    expect(coordinator.isCurrent(cancelled)).toBe(false);
    expect(coordinator.isCurrent(replacement)).toBe(true);
  });

  it("cancel releases a pending worker await so rerun is not blocked", async () => {
    const coordinator = new SearchRunCoordinator();
    const firstToken = coordinator.begin();

    let pending: PendingWorkerJob | null = {
      id: "job-1",
      runToken: firstToken,
      resolve: () => {},
      reject: () => {},
    };

    const workerDone = new Promise<SearchResult | null>((resolve) => {
      pending!.resolve = resolve;
    });

    const releasePending = (result: SearchResult | null) => {
      const current = pending;
      if (!current) return null;
      pending = null;
      current.resolve(result);
      return current;
    };

    const rerun = simulateCancelThenRerun(coordinator, pending, releasePending);

    expect(await workerDone).toBeNull();
    expect(rerun.firstStillCurrent).toBe(false);
    expect(rerun.secondCurrent).toBe(true);
    expect(pending).toBeNull();
  });
});
