/**
 * The chrome's tooltips, one layer for the whole page: any element carrying `data-tooltip` gets a
 * drawn panel under it on hover and on keyboard focus, after a short delay. What it replaces is
 * the native `title`, which waits about a second, takes the platform's look and never shows on
 * focus. Like `title`, the attribute names nothing to assistive technology, so an element whose
 * only name was its title carries an `aria-label` with the same words.
 *
 * The panel is portaled to the body at fixed viewport coordinates and takes no pointer events, so
 * it never covers a click meant for what it describes, and it closes on leave, blur, Escape, a
 * press (the element is being used now, not asked about), any scroll and a resize — the last
 * three because it is placed once and would be stale the moment its trigger moved.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { placeTip } from "../lib/tip";
import type { TipPlacement } from "../lib/tip";

export const TOOLTIP_ATTR = "data-tooltip";

/**
 * Long enough that a pointer crossing the bar on its way elsewhere leaves no trail of panels,
 * short enough to answer a pointer that stopped to ask.
 */
const OPEN_DELAY_MS = 350;

/** The width a hint wraps at, before the room left on screen caps it further. */
const MAX_WIDTH = 280;

export function ChromeTooltips() {
  const [open, setOpen] = useState<{ label: string; at: TipPlacement } | null>(null);

  useEffect(() => {
    let current: Element | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const close = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      current = null;
      setOpen(null);
    };
    const holder = (node: EventTarget | null): Element | null =>
      node instanceof Element ? node.closest(`[${TOOLTIP_ATTR}]`) : null;
    const start = (node: Element | null) => {
      if (node === current) return;
      close();
      const label = node?.getAttribute(TOOLTIP_ATTR)?.trim() ?? "";
      if (node === null || label === "") return;
      const el: Element = node;
      current = el;
      timer = setTimeout(() => {
        timer = null;
        if (!el.isConnected) return;
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        setOpen({ label, at: placeTip(el.getBoundingClientRect(), viewport) });
      }, OPEN_DELAY_MS);
    };
    const onOver = (event: PointerEvent) => start(holder(event.target));
    const onOut = (event: PointerEvent) => {
      if (current === null) return;
      const next = event.relatedTarget;
      if (next instanceof Node && current.contains(next)) return;
      close();
    };
    const onFocusIn = (event: FocusEvent) => start(holder(event.target));
    const onKey = (event: KeyboardEvent) => {
      // Heard, never stopped: the same press still reaches the popover or drawer behind it.
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", close);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      close();
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", close);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, []);

  if (open === null) return null;
  return createPortal(
    <div
      className="g-chrome g-tip"
      aria-hidden
      style={{
        top: open.at.top,
        left: open.at.left,
        right: open.at.right,
        maxWidth: Math.min(MAX_WIDTH, open.at.room),
      }}
    >
      {open.label}
    </div>,
    document.body,
  );
}
