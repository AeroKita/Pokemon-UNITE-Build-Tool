import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bundled from "../patch-current.json";

const CACHE_KEY = "unite-build-optimizer.dataCache.v1";

function mockLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  });
  return store;
}

describe("activeRaw", () => {
  beforeEach(() => {
    vi.resetModules();
    mockLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns baseline when cache is empty", async () => {
    const { activeRaw } = await import("../dataSource");
    expect(activeRaw(bundled)).toBe(bundled);
  });

  it("returns cached raw when cache version is strictly newer than baseline lastUpdated", async () => {
    const store = mockLocalStorage();
    const cached = { ...bundled, patchVersion: "9.99.9.9" };
    store.set(
      CACHE_KEY,
      JSON.stringify({
        version: "2099-01-01",
        patchVersion: "9.99.9.9",
        raw: cached,
        fetchedAt: Date.now(),
      }),
    );
    const { activeRaw } = await import("../dataSource");
    const result = activeRaw(bundled) as { patchVersion: string };
    expect(result.patchVersion).toBe("9.99.9.9");
  });

  it("clears cache and returns baseline when cache version is not newer", async () => {
    const store = mockLocalStorage();
    store.set(
      CACHE_KEY,
      JSON.stringify({
        version: "2000-01-01",
        patchVersion: "1.0.0.0",
        raw: { stale: true },
        fetchedAt: Date.now(),
      }),
    );
    const { activeRaw } = await import("../dataSource");
    expect(activeRaw(bundled)).toBe(bundled);
    expect(store.has(CACHE_KEY)).toBe(false);
  });

  it("clears cache and returns baseline when cache version equals baseline lastUpdated", async () => {
    const store = mockLocalStorage();
    store.set(
      CACHE_KEY,
      JSON.stringify({
        version: bundled.lastUpdated,
        patchVersion: bundled.patchVersion,
        raw: { tied: true },
        fetchedAt: Date.now(),
      }),
    );
    const { activeRaw } = await import("../dataSource");
    expect(activeRaw(bundled)).toBe(bundled);
    expect(store.has(CACHE_KEY)).toBe(false);
  });
});
