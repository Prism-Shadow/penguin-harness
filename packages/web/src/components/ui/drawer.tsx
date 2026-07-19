/**
 * Drawer component (for mobile nav/panels): overlay fades in + panel slides in from the side; Esc or clicking the overlay closes it.
 * `side` determines the docking direction; the panel width defaults to 80vw, capped by widthClass.
 */
import { useEffect } from "react";
import type { ReactNode } from "react";
import { S } from "../../lib/strings";

export interface DrawerProps {
  open: boolean;
  side?: "left" | "right";
  title?: string;
  onClose: () => void;
  children: ReactNode;
  /** Panel max-width class (default max-w-xs). */
  widthClass?: string;
}

export function Drawer({ open, side = "left", title, onClose, children, widthClass }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="anim-fade absolute inset-0 bg-black/45" onMouseDown={onClose} />
      <div
        className={`absolute inset-y-0 flex w-[80vw] flex-col bg-white shadow-xl dark:bg-gray-900 ${widthClass ?? "max-w-xs"} ${
          side === "left"
            ? "anim-drawer-left left-0 border-r border-gray-200 dark:border-gray-800"
            : "anim-drawer-right right-0 border-l border-gray-200 dark:border-gray-800"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <span className="text-base font-semibold">{title ?? ""}</span>
          <button
            type="button"
            aria-label={S.common.close}
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor">
              <path d="M2 2l10 10M12 2L2 12" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {children}
        </div>
      </div>
    </div>
  );
}
