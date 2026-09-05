/**
 * Drawer component (for mobile nav/panels): overlay fades in + panel slides in from the side; Esc or clicking the overlay closes it.
 * `side` determines the docking direction; the panel width defaults to 80vw, capped by widthClass.
 *
 * Escape goes through the shared esc-layer stack (see modal.tsx), so a dialog or menu opened
 * from inside a drawer takes the first Escape alone: without that, one press would close the
 * confirmation *and* the drawer under it, dropping the panel the user was working in.
 */
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { CloseButton } from "./icons";
import { isTopEscLayer, popEscLayer, pushEscLayer } from "./modal";

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
  // Latest-callback ref, so the effect below re-runs ONLY on open/close: call sites pass an
  // inline arrow for onClose, and re-running on its identity would pop and re-push this
  // drawer's esc-layer on every render — jumping it back above a dialog opened inside it.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const layer = pushEscLayer();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopEscLayer(layer)) onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      popEscLayer(layer);
    };
  }, [open]);

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
          <CloseButton onClose={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {children}
        </div>
      </div>
    </div>
  );
}
