/**
 * Dropdown container (controlled): clicking outside collapses it; the panel is absolutely
 * positioned (z-40, per the layering convention — chrome avoids stacking contexts, menus are
 * z-40, overlays are z-50). menuClass controls the docking direction and width.
 */
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export function Dropdown({
  button,
  open,
  setOpen,
  children,
  menuClass,
  className,
}: {
  button: ReactNode;
  open: boolean;
  setOpen: (v: boolean) => void;
  children: ReactNode;
  /** Panel positioning and size (default: downward, left-aligned, w-64). */
  menuClass?: string;
  /** Extra classes for the root container (e.g. flex-1 in a flex layout). */
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);
  return (
    <div className={`relative ${className ?? ""}`} ref={ref}>
      {button}
      {open && (
        <div
          className={`anim-pop absolute z-40 max-h-[70vh] overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900 ${
            menuClass ?? "left-0 top-full mt-1 w-64 max-w-[calc(100vw-2rem)] origin-top-left"
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
