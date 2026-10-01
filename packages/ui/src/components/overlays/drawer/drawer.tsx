/**
 * Drawer component (for mobile nav/panels): overlay fades in + panel slides in from the side; Esc
 * or clicking the overlay closes it. `side` determines the docking direction; the panel width
 * defaults to 80vw, capped by widthClass.
 *
 * Escape goes through the shared Escape-layer stack, so a dialog or menu opened from inside a
 * drawer takes the first Escape alone: without that, one press would close the confirmation *and*
 * the drawer under it, dropping the panel the user was working in.
 */
import type { ReactNode } from "react";
import { CloseButton } from "../../actions/close-button/close-button";
import { useEscLayer } from "../esc-layers/esc-layers";

export interface DrawerProps {
  open: boolean;
  side?: "left" | "right";
  title?: string;
  onClose: () => void;
  children: ReactNode;
  /** Panel max-width class (default max-w-xs). */
  widthClass?: string;
  /** The header's close cross's accessible name; defaults to the interface's word for "close". */
  closeLabel?: string;
}

export function Drawer({
  open,
  side = "left",
  title,
  onClose,
  children,
  widthClass,
  closeLabel,
}: DrawerProps) {
  useEscLayer(open, onClose);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div
        // ui-scrim: the dimmed layer behind the drawer; a theme may blur the page through it.
        className="ui-scrim anim-fade absolute inset-0 bg-[var(--ui-overlay-backdrop)]"
        onMouseDown={onClose}
      />
      <div
        className={`absolute inset-y-0 flex w-[80vw] flex-col bg-surface shadow-xl ${widthClass ?? "max-w-xs"} ${
          side === "left"
            ? "anim-drawer-left left-0 border-r border-line"
            : "anim-drawer-right right-0 border-l border-line"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
          <span className="text-base font-semibold">{title ?? ""}</span>
          <CloseButton onClose={onClose} label={closeLabel} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {children}
        </div>
      </div>
    </div>
  );
}
