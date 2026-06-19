import { useState, type ReactNode } from "react";

const storageKey = (k: string) => `unite-build-optimizer.collapsed.${k}`;

type Tone = "default" | "indigo" | "amber" | "sky";

const TONES: Record<Tone, { card: string; title: string }> = {
  default: { card: "border-line bg-surface", title: "text-muted" },
  indigo: { card: "border-rec-border bg-rec-bg", title: "text-rec-ink" },
  amber: { card: "border-as-border bg-as-bg", title: "text-as-ink" },
  sky: { card: "border-an-border bg-an-bg", title: "text-an-ink" },
};

/**
 * A titled card whose body collapses/expands via a chevron. Open state persists
 * per `persistKey`. `right` renders controls in the header (clicks there don't
 * toggle). `center` renders centered in the header row (same click behavior).
 * Used for every major section so the UI stays uncluttered.
 */
export function CollapsibleCard({
  title,
  persistKey,
  defaultOpen = true,
  right,
  center,
  tone = "default",
  children,
}: {
  title: string;
  persistKey: string;
  defaultOpen?: boolean;
  right?: ReactNode;
  center?: ReactNode;
  tone?: Tone;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(storageKey(persistKey));
      return v === null ? defaultOpen : v === "1";
    } catch {
      return defaultOpen;
    }
  });
  const toggle = () =>
    setOpen((o) => {
      const next = !o;
      try {
        localStorage.setItem(storageKey(persistKey), next ? "1" : "0");
      } catch {
        /* quota */
      }
      return next;
    });

  const t = TONES[tone];
  return (
    <section className={`rounded-2xl border shadow-sm ${t.card}`}>
      <header
        className={`relative flex cursor-pointer select-none items-center gap-2 px-4 py-3 ${
          center ? "min-h-[4.25rem] justify-start" : "min-h-11 justify-between"
        }`}
        onClick={toggle}
      >
        <div
          className={`flex min-w-0 items-center gap-2 ${center ? "max-w-[calc(50%-4.5rem)]" : ""}`}
        >
          <span
            aria-hidden
            className={`shrink-0 text-faint transition-transform ${open ? "" : "-rotate-90"}`}
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5.5 7.5 10 12l4.5-4.5" />
            </svg>
          </span>
          <h3 className={`truncate text-sm font-semibold uppercase tracking-wide ${t.title}`}>
            {title}
          </h3>
        </div>
        {center && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center px-4 pt-3 pb-3">
            <div className="pointer-events-auto" onClick={(e) => e.stopPropagation()}>
              {center}
            </div>
          </div>
        )}
        {right && <div onClick={(e) => e.stopPropagation()}>{right}</div>}
      </header>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}
