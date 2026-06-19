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

describe("checkDataNow", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    mockLocalStorage();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockManifest(manifest: { version: string; patchVersion: string; url: string }) {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("manifest.json")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(manifest) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    });
  }

  function mockManifestAndBundle(
    manifest: { version: string; patchVersion: string; url: string },
    bundleBody: unknown,
  ) {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("manifest.json")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(manifest) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(bundleBody) });
    });
  }

  it("does not treat an older remote version as an update", async () => {
    const store = mockLocalStorage();
    mockManifest({
      version: "2026-06-16",
      patchVersion: bundled.patchVersion,
      url: "https://example.com/patch.json",
    });
    const { checkDataNow } = await import("../dataSource");
    const result = await checkDataNow(bundled.lastUpdated);
    expect(result.status).toBe("current");
    expect(store.has(CACHE_KEY)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("manifest.json");
  });

  it("treats a strictly newer remote version as an update and caches it", async () => {
    const store = mockLocalStorage();
    mockManifestAndBundle(
      {
        version: "2099-01-01",
        patchVersion: "9.99.9.9",
        url: "https://example.com/patch-9.99.9.9.json",
      },
      bundled,
    );
    const { checkDataNow } = await import("../dataSource");
    const result = await checkDataNow(bundled.lastUpdated);
    expect(result.status).toBe("updated");
    expect(result.patchVersion).toBe("9.99.9.9");
    expect(store.has(CACHE_KEY)).toBe(true);
    const cached = JSON.parse(store.get(CACHE_KEY)!);
    expect(cached.version).toBe("2099-01-01");
  });

  it("treats an equal remote version as current", async () => {
    mockManifest({
      version: bundled.lastUpdated,
      patchVersion: bundled.patchVersion,
      url: "https://example.com/patch.json",
    });
    const { checkDataNow } = await import("../dataSource");
    const result = await checkDataNow(bundled.lastUpdated);
    expect(result.status).toBe("current");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns offline when the manifest is unreachable", async () => {
    fetchMock.mockResolvedValue({ ok: false });
    const { checkDataNow } = await import("../dataSource");
    const result = await checkDataNow(bundled.lastUpdated);
    expect(result.status).toBe("offline");
  });
});
