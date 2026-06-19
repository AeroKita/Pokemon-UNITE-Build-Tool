import { useModalDismiss } from "./useModalDismiss";
import { heldItemStatLines } from "./format";
import { statsAtGrade } from "../components/tips";
import type { HeldItem } from "../types";

/** Grade 1–9 → tier 0, 10–19 → tier 1, 20–40 → tier 2. */
export function activeTierIndex(grade: number): 0 | 1 | 2 {
  if (grade < 10) return 0;
  if (grade < 20) return 1;
  return 2;
}

export function HeldItemDetailBody({ item, grade }: { item: HeldItem; grade: number }) {
  const statLines = heldItemStatLines(statsAtGrade(item, grade));
  const effect = item.effect;
  const active = activeTierIndex(grade);

  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed">
      <h3 id="held-item-detail-title" className="text-base font-bold text-ink">
        {item.displayName}
      </h3>

      {/* Flat stats at the current grade — green because they scale with the slider. */}
      {statLines.length > 0 && (
        <div className="flex flex-col gap-0.5 font-mono text-sm">
          {statLines.map((l) => (
            <span key={l.key} className="font-semibold text-pos">
              {l.label} {l.value}
            </span>
          ))}
        </div>
      )}

      {item.description && <p className="text-muted">{item.description}</p>}

      {/* Grade 1 / 10 / 20 effect scaling, with the tier active at this grade in green. */}
      {effect && (
        <div className="border-t border-line pt-3">
          <p className="font-mono text-sm">
            {effect.tiers.map((v, i) => (
              <span key={i}>
                {i > 0 && <span className="text-muted"> / </span>}
                <span className={i === active ? "font-semibold text-pos" : "text-muted"}>{v}</span>
              </span>
            ))}{" "}
            <span className="font-semibold text-pos">{effect.label}</span>
          </p>
          <p className="mt-1 font-mono text-xs text-muted">
            {[1, 10, 20].map((lvl, i) => (
              <span key={lvl}>
                {i > 0 && " / "}
                <span className={i === active ? "font-semibold text-pos" : ""}>{lvl}</span>
              </span>
            ))}{" "}
            <span className="font-semibold text-pos">Item Level</span>
          </p>
        </div>
      )}
    </div>
  );
}

export function HeldItemDetailModal({
  item,
  grade,
  open,
  onClose,
}: {
  item: HeldItem | null;
  grade: number;
  open: boolean;
  onClose: () => void;
}) {
  useModalDismiss(onClose, open);
  if (!open || !item) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="held-item-detail-title"
      >
        <div className="mb-3 flex justify-end">
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg border border-line px-2 py-0.5 text-sm text-muted hover:bg-raise"
          >
            ✕
          </button>
        </div>
        <HeldItemDetailBody item={item} grade={grade} />
      </div>
    </div>
  );
}
