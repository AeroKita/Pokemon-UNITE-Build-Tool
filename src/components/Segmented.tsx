/**
 * Segmented control — pill-shaped mutually exclusive option buttons.
 * Two visual variants:
 *   "surface"  (default) — for use in page content (bg-raise backdrop)
 *   "header"   — for use in the sticky header (bg-white/15 backdrop)
 */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  labels,
  disabled = false,
  title,
  variant = "surface",
  fluid = false,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  /** Optional display labels; defaults to option strings (capitalised). */
  labels?: Partial<Record<T, string>>;
  disabled?: boolean;
  title?: string;
  variant?: "surface" | "header";
  /**
   * When true the control fills its container and the options share the width
   * equally. Use on mobile to keep option buttons on a single row (no wrap /
   * horizontal overflow).
   */
  fluid?: boolean;
}) {
  const backdrop =
    variant === "header"
      ? "bg-white/15"
      : "bg-raise";

  const active =
    variant === "header"
      ? "bg-surface text-accent-ink shadow"
      : "bg-surface text-ink shadow-sm";

  const inactive =
    variant === "header"
      ? "text-white/90 hover:bg-white/10"
      : "text-muted hover:text-ink";

  return (
    <div
      title={title}
      className={`flex gap-1 rounded-xl p-1 ${backdrop} ${fluid ? "w-full" : ""} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      {options.map((o) => (
        <button
          key={o}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o)}
          className={`min-w-0 truncate rounded-lg px-3 py-1.5 text-center text-sm font-medium capitalize transition ${
            fluid ? "flex-1" : ""
          } ${value === o ? active : inactive} ${disabled ? "pointer-events-none" : ""}`}
        >
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}
