import type { ReactNode } from "react";
import { useModalDismiss } from "../../ui/useModalDismiss";

interface BottomSheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Pin the panel to a constant height so it doesn't resize as content
   *  changes (e.g. live-filtering a picker). Defaults to content-fit. */
  fillHeight?: boolean;
}

/**
 * Responsive overlay: bottom sheet on phones, centered modal on sm+.
 * Shared shell for pickers, settings, and other modal flows.
 */
export function BottomSheet({ title, onClose, children, footer, fillHeight }: BottomSheetProps) {
  useModalDismiss(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`flex w-full flex-col rounded-t-2xl bg-surface pb-safe shadow-xl sm:max-w-2xl sm:rounded-2xl ${
          fillHeight ? "h-[88vh] sm:h-[80vh]" : "max-h-[88vh] sm:max-h-[80vh]"
        }`}
      >
        <div className="mx-auto mt-2 h-1.5 w-9 rounded-full bg-line sm:hidden" />
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="min-w-0 truncate text-lg font-bold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-faint hover:bg-raise"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-line bg-surface px-4 py-3 pb-safe">{footer}</div>
        )}
      </div>
    </div>
  );
}
