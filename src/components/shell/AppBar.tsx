import type { ReactNode } from "react";
import { type ViewMode } from "../../state/store";

interface AppBarProps {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  onTitleTap?: () => void;
  onSettings: () => void;
  mode: ViewMode;
  onModeChange: (m: ViewMode) => void;
}

function GearIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function ModeToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const isAdvanced = value === "expert";
  return (
    <button
      type="button"
      onClick={() => onChange(isAdvanced ? "beginner" : "expert")}
      aria-pressed={isAdvanced}
      aria-label={
        isAdvanced
          ? "Advanced mode — tap to switch to Basic"
          : "Basic mode — tap to switch to Advanced"
      }
      title={isAdvanced ? "Advanced mode — tap for Basic" : "Basic mode — tap for Advanced"}
      className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-semibold shadow-sm transition ${
        isAdvanced
          ? "bg-[var(--color-mode-advanced-bg)] text-[var(--color-mode-advanced-ink)]"
          : "bg-[var(--color-mode-basic-bg)] text-[var(--color-mode-basic-ink)]"
      }`}
    >
      {isAdvanced ? "Advanced" : "Basic"}
    </button>
  );
}

/**
 * Fixed top bar: title block, mode toggle, and settings entry point.
 */
export function AppBar({
  title,
  subtitle,
  leading,
  onTitleTap,
  onSettings,
  mode,
  onModeChange,
}: AppBarProps) {
  const titleBlock = (
    <div className="min-w-0 flex-1">
      <div className="truncate text-base font-bold leading-tight sm:text-lg">{title}</div>
      {subtitle && (
        <div className="truncate text-xs text-[var(--color-appbar-sub)]">{subtitle}</div>
      )}
    </div>
  );

  return (
    <header className="fixed inset-x-0 top-0 z-30 border-b border-[var(--color-appbar-border)] bg-gradient-to-r from-[var(--color-appbar-from)] to-[var(--color-appbar-to)] pt-safe text-[var(--color-appbar-ink)] shadow-sm">
      <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-3 sm:px-4">
        {leading}
        {onTitleTap ? (
          <button
            type="button"
            onClick={onTitleTap}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            {titleBlock}
          </button>
        ) : (
          titleBlock
        )}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <ModeToggle value={mode} onChange={onModeChange} />
          <button
            type="button"
            onClick={onSettings}
            aria-label="Settings"
            title="Settings"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl hover:bg-black/5 dark:hover:bg-white/15"
          >
            <GearIcon />
          </button>
        </div>
      </div>
    </header>
  );
}
