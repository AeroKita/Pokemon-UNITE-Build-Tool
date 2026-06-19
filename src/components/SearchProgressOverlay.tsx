/**
 * Single full-screen progress overlay for the emblem search.
 * One overlay, one bar — no multiple spinners.
 */

import type { SearchProgress } from "../engine/emblemSearch/types";

interface Props {
  progress: SearchProgress;
  /** Estimated time remaining, e.g. "~12s remaining". Null when not yet
   *  computable (early in search) or when search is complete/cancelled. */
  eta?: string | null;
  onCancel: () => void;
}

export function SearchProgressOverlay({ progress, eta, onCancel }: Props) {
  const pct = Math.max(0, Math.min(100, progress.pct));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xs rounded-2xl border border-line bg-surface p-4 shadow-xl sm:max-w-sm sm:p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink">Searching…</h2>
        <div className="mb-2 h-2 overflow-hidden rounded-full bg-white/20">
          <div
            className="h-full rounded-full bg-accent transition-all duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-start justify-between gap-2 text-xs text-muted">
          <span className="min-w-0 break-words">{progress.label}</span>
          <span className="shrink-0 font-mono">{pct.toFixed(0)}%</span>
        </div>
        {/* Reserve a min-height row so the layout doesn't jump as ETA appears,
            and let the metrics wrap to a second line instead of truncating. */}
        <div className="mt-1 flex min-h-4 flex-wrap gap-x-2 text-xs tabular-nums text-faint">
          {eta != null && <span>{eta}</span>}
          {progress.candidates != null && (
            <span>
              {progress.totalCandidates != null
                ? `${progress.candidates.toLocaleString()} / ${progress.totalCandidates.toLocaleString()} builds`
                : `${progress.candidates.toLocaleString()} evaluated`}
            </span>
          )}
        </div>
        <button
          onClick={onCancel}
          className="mt-3 w-full rounded-xl border border-line bg-white/10 py-2 text-sm font-medium text-muted hover:bg-white/20 active:scale-95"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
