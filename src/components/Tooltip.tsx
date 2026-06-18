import { type ReactNode, useRef, useState } from "react";
import { useModalDismiss } from "../ui/useModalDismiss";

const LONG_PRESS_MS = 500;

// Lightweight CSS hover tooltip (no deps). Renders a styled popup on hover/focus.
// Touch/pen long-press opens the same content in a dismissible modal popup.
// Use inside containers that don't clip overflow (panels, not scroll lists).
export function Tooltip({
  content,
  children,
  side = "bottom",
  className = "",
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
}) {
  const pos = side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5";
  const [pinned, setPinned] = useState(false);
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);

  useModalDismiss(() => setPinned(false), pinned);

  const clearTimer = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    firedRef.current = false;
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
    start.current = { x: e.clientX, y: e.clientY };
    clearTimer();
    timer.current = window.setTimeout(() => {
      firedRef.current = true;
      setPinned(true);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clearTimer();
  };

  const cancel = () => {
    clearTimer();
    start.current = null;
  };

  return (
    <span
      className={`group/tt relative inline-flex select-none [-webkit-touch-callout:none] ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onClickCapture={(e) => {
        if (firedRef.current) {
          e.preventDefault();
          e.stopPropagation();
          firedRef.current = false;
        }
      }}
    >
      {children}
      <span
        role="tooltip"
        style={{ background: "var(--color-tip-bg)", color: "var(--color-tip-ink)" }}
        className={`pointer-events-none absolute left-1/2 z-50 hidden w-max max-w-[240px] -translate-x-1/2 ${pos} whitespace-pre-line rounded-lg px-2.5 py-1.5 text-left text-[11px] leading-snug shadow-xl ring-1 ring-black/10 group-hover/tt:block`}
      >
        {content}
      </span>

      {pinned && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setPinned(false)}
        >
          <div
            className="max-h-[70vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="text-sm leading-snug text-ink">{content}</div>
          </div>
        </div>
      )}
    </span>
  );
}
