/**
 * ETA formatting helpers for the search progress overlay.
 *
 * Mirrors the formatDuration / updateSearchEta approach from uniteemblemfinder
 * (clean-room re-implementation, AGPL→GPL):
 *   - linear extrapolation from elapsed time and current pct
 *   - EMA smoothing (α=0.4 on new sample, 0.6 on previous)
 *   - human-readable output: "45s", "2m 30s"
 */

/**
 * Format a duration in seconds to a human-readable string.
 *
 * Examples:
 *   formatEtaDuration(45)   → "45s"
 *   formatEtaDuration(150)  → "2m 30s"
 *   formatEtaDuration(60)   → "1m 0s"
 */
export function formatEtaDuration(sec: number): string {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

/**
 * Compute the smoothed ETA string given the current progress state.
 *
 * Returns:
 *   - null       when pct is 0 or ≥ 100 (don't show ETA)
 *   - "Estimating…"  when not enough time or progress has elapsed yet
 *   - "~Xs remaining" / "~Xm Ys remaining" otherwise
 *
 * @param pct             Current progress 0–100
 * @param startTime       Date.now() value when the search started (ms)
 * @param smoothedRef     Ref object holding the smoothed remaining-seconds value
 *                        (mutated in place for EMA; set to null to reset)
 */
export function computeSearchEta(
  pct: number,
  startTime: number,
  smoothedRef: { current: number | null },
): string | null {
  if (pct <= 0 || pct >= 100) return null;
  if (!startTime) return null;

  const elapsed = (Date.now() - startTime) / 1000;

  if (elapsed < 0.4 || pct < 2) return "Estimating…";

  const rawRemaining = elapsed * (100 - pct) / pct;

  smoothedRef.current =
    smoothedRef.current == null
      ? rawRemaining
      : 0.6 * smoothedRef.current + 0.4 * rawRemaining;

  return `~${formatEtaDuration(smoothedRef.current)} remaining`;
}
