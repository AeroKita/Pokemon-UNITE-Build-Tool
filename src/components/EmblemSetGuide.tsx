import { EMBLEM_COLOR_HEX } from "../ui/colors";
import { EMBLEM_SET_INFO, type SetInfoRow } from "../ui/emblemSets";
import { useModalDismiss } from "../ui/useModalDismiss";

function Row({ r }: { r: SetInfoRow }) {
  return (
    <div className="flex items-start gap-3 border-t border-line py-2 first:border-t-0">
      <span
        className="mt-0.5 h-4 w-4 shrink-0 rounded-full ring-1 ring-black/10"
        style={{ background: EMBLEM_COLOR_HEX[r.color] }}
      />
      <div className="w-28 shrink-0">
        <div className="text-sm font-medium capitalize text-ink">{r.color}</div>
        <div className="text-[11px] leading-tight text-faint">
          {r.label}
          {r.note ? ` · ${r.note}` : ""}
        </div>
      </div>
      <div className="flex flex-1 flex-wrap gap-1">
        {r.tiers.map((t) => (
          <span
            key={t.count}
            className="rounded bg-raise px-1.5 py-0.5 font-mono text-[11px] text-muted"
          >
            {t.count}×{" "}
            <span className="font-semibold text-ink">
              {r.kind === "stat" ? "+" : "−"}
              {t.percent}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Infographic explaining every emblem color set and its tier bonuses. */
export function EmblemSetGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  useModalDismiss(onClose, open);
  if (!open) return null;
  const stat = EMBLEM_SET_INFO.filter((r) => r.kind === "stat");
  const util = EMBLEM_SET_INFO.filter((r) => r.kind === "utility");
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-lg font-bold text-ink">Emblem color sets</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg border border-line px-2 py-0.5 text-sm text-muted hover:bg-raise"
          >
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-muted">
          Equipping emblems of the same color unlocks set bonuses. One emblem per Pokémon counts
          toward a color, and a dual-color emblem counts toward both. The highest tier you reach
          applies.
        </p>

        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
          Stat sets
        </p>
        <div className="mb-4">
          {stat.map((r) => (
            <Row key={r.color} r={r} />
          ))}
        </div>

        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
          Utility sets
        </p>
        <div>
          {util.map((r) => (
            <Row key={r.color} r={r} />
          ))}
        </div>
      </div>
    </div>
  );
}
