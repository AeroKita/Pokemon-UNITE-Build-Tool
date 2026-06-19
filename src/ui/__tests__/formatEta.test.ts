import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { formatEtaDuration, computeSearchEta } from "../formatEta";

describe("formatEtaDuration", () => {
  it("formats seconds under 60", () => {
    expect(formatEtaDuration(0)).toBe("0s");
    expect(formatEtaDuration(1)).toBe("1s");
    expect(formatEtaDuration(45)).toBe("45s");
    expect(formatEtaDuration(59)).toBe("59s");
  });

  it("formats minutes+seconds at 60 and above", () => {
    expect(formatEtaDuration(60)).toBe("1m 0s");
    expect(formatEtaDuration(90)).toBe("1m 30s");
    expect(formatEtaDuration(150)).toBe("2m 30s");
    expect(formatEtaDuration(3600)).toBe("60m 0s");
  });

  it("rounds fractional seconds", () => {
    expect(formatEtaDuration(45.4)).toBe("45s");
    expect(formatEtaDuration(45.6)).toBe("46s");
  });

  it("clamps negative input to 0", () => {
    expect(formatEtaDuration(-5)).toBe("0s");
  });
});

describe("computeSearchEta", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when pct is 0", () => {
    const ref = { current: null };
    vi.setSystemTime(1000);
    expect(computeSearchEta(0, 0, ref)).toBeNull();
  });

  it("returns null when pct is 100", () => {
    const ref = { current: null };
    vi.setSystemTime(1000);
    expect(computeSearchEta(100, 500, ref)).toBeNull();
  });

  it("returns null when startTime is 0", () => {
    const ref = { current: null };
    vi.setSystemTime(1000);
    expect(computeSearchEta(50, 0, ref)).toBeNull();
  });

  it("returns 'Estimating…' before enough elapsed time", () => {
    const ref = { current: null };
    const start = 1000;
    vi.setSystemTime(start + 200); // only 0.2s elapsed
    expect(computeSearchEta(50, start, ref)).toBe("Estimating…");
  });

  it("returns 'Estimating…' before pct reaches 2", () => {
    const ref = { current: null };
    const start = 1000;
    vi.setSystemTime(start + 2000); // 2s elapsed, but pct=1 < 2
    expect(computeSearchEta(1, start, ref)).toBe("Estimating…");
  });

  it("computes remaining time via linear extrapolation", () => {
    const ref = { current: null };
    const start = 1_000_000; // realistic non-zero timestamp
    // After 10s at 50% → remaining = 10 * (100-50)/50 = 10s
    vi.setSystemTime(start + 10_000);
    const result = computeSearchEta(50, start, ref);
    expect(result).toBe("~10s remaining");
    expect(ref.current).toBe(10); // smoothed equals raw on first sample
  });

  it("applies EMA smoothing on subsequent calls", () => {
    const ref = { current: null };
    const start = 1_000_000;

    // First call: 10s at 50% → raw=10, smoothed=10
    vi.setSystemTime(start + 10_000);
    computeSearchEta(50, start, ref);

    // Second call: 15s at 60% → raw = 15*(40/60) = 10, smoothed = 0.6*10 + 0.4*10 = 10
    vi.setSystemTime(start + 15_000);
    const result = computeSearchEta(60, start, ref);
    expect(result).toBe("~10s remaining");
    expect(ref.current).toBeCloseTo(10, 1);
  });

  it("returns 'Estimating…' when pct<2 even after enough time", () => {
    const ref = { current: null };
    const start = 1_000_000;
    // After 1s at 1% → pct < 2 → still "Estimating…"
    vi.setSystemTime(start + 1_000);
    const result = computeSearchEta(1, start, ref);
    expect(result).toBe("Estimating…");
  });

  it("computes multi-minute ETA when pct>=2", () => {
    const ref = { current: null };
    const start = 1_000_000;
    // After 2s at 2% → remaining = 2 * 98/2 = 98s = 1m 38s
    vi.setSystemTime(start + 2_000);
    const result = computeSearchEta(2, start, ref);
    expect(result).toBe("~1m 38s remaining");
  });
});
