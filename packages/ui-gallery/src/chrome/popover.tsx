/**
 * A disclosure in the top bar: an icon button that opens a panel under itself, right-aligned,
 * holding the controls that do not fit the bar. Not portaled — the bar is sticky, so the panel
 * scrolls with it and nothing clips it. It closes on a click outside, on Escape (focus returns to
 * the button) and when its button is pressed again. A click inside a select's list, which is
 * portaled to the body and so outside the panel's subtree, is not a click outside.
 */
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChromeIcon } from "./icons";
import type { ChromeIconName } from "./icons";

export function Popover({
  label,
  icon,
  children,
}: {
  label: string;
  icon: ChromeIconName;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (root.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".g-listbox")) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="g-popover">
      <button
        ref={button}
        type="button"
        className="g-icon-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={label}
        data-tooltip={open ? undefined : label}
        onClick={() => setOpen((current) => !current)}
      >
        <ChromeIcon name={icon} size={16} />
      </button>
      {open && (
        <div id={panelId} role="dialog" aria-label={label} className="g-popover-panel">
          {children}
        </div>
      )}
    </div>
  );
}
