/**
 * The app's one tooltip: a hover/focus panel for a control whose visible form is an icon
 * alone, for a line a row truncates (`content="code"` or `"text"`), and for any hint an
 * element offers on hover.
 *
 * What it replaces is the native `title` attribute, which the app does not use at all: that
 * one waits about a second before it appears, cannot be styled or themed, and never shows on
 * keyboard focus — so an icon rail labeled only by `title` reads as unlabeled. A guard test
 * fails on a `title` attribute on an intrinsic element.
 *
 * Either way in, a hint shows only for an element with no visible text of its own or one
 * whose visible text is cut off (`hintAllowed`, checked when the hint would open): a label the
 * reader can already read in full gets no tooltip.
 *
 * Two ways in, one panel:
 * - `<Tooltip label>` wraps its trigger in a measuring span — for a trigger that needs the
 *   wrapper's extras (`suppressed`, a placement beside a rail).
 * - `data-tooltip="…"` on any element, read by the one `<TooltipLayer />` mounted at the app
 *   root, which listens once on the document. It adds no wrapper, so it is what replaces a
 *   `title` in place: a table cell, a truncated span or a flex child keeps its layout exactly.
 *   `data-tooltip-content` picks the panel's kind, `data-tooltip-placement` its side
 *   (default `bottom`). Unlike `title`, it names nothing to assistive technology, so an
 *   element whose only name was its title carries an `aria-label` with the same words.
 *
 * Portaled to document.body at fixed viewport coordinates, like every other overlay here
 * (see use-portal-panel.ts): an in-place absolute panel is a descendant of its trigger, so a
 * scrolling or clipping ancestor — a collapsed rail is both — cuts it off. It sits on the
 * portaled-panel layer (z-[60]) and takes no pointer events, so it can never swallow a click
 * meant for what it covers. It is drawn on the overlay surface every menu uses, in the body ink.
 *
 * Two geometries, chosen by the shape of the control strip rather than by taste: `right` for
 * a vertical rail, `bottom` for a horizontal toolbar, where a panel to the side would cover
 * the very buttons next to the one being asked about.
 *
 * Deliberately NOT `role="tooltip"` + `aria-describedby`: its callers label their triggers
 * with the same words it shows, and a description repeating the accessible name makes a
 * screen reader say the entry twice. The panel is decorative here and hidden from the
 * accessibility tree; the trigger's own `aria-label` stays the one name. A truncated line
 * keeps its whole text in the DOM, so the same holds there.
 *
 * Dismissal mirrors the portal panel's, minus the parts a hover-driven panel has no use for
 * (no outside click, no Esc layer): it closes on pointer leave, on blur, on Escape, on any
 * scroll and on a resize — the last three because the position is measured once and is stale
 * the moment the trigger moves.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * Open delay. Long enough that a pointer crossing a column of icons on its way elsewhere
 * leaves no trail of popping panels, short enough to answer a pointer that stopped to ask.
 */
const OPEN_DELAY_MS = 400;

/** Gap between the trigger's edge and the panel, and the panel's minimum distance from the viewport edge (px). */
const PANEL_GAP = 8;
const VIEWPORT_MARGIN = 8;

/** Which side of its trigger the panel hangs off. */
export type TooltipPlacement = "right" | "bottom";

/**
 * What the panel holds, which decides how it sets its text and how wide it may grow.
 *
 * - `label`: a control's name — a few words, capped narrow.
 * - `code`: a line of code its row truncated (a background process's command). Monospace like
 *   the row it stands for, and wider, because it is read rather than glanced at. It breaks
 *   anywhere — a path or a run of flags has no space to wrap at — and keeps its own line
 *   breaks, so a multi-line command reads the way it was written.
 * - `text`: prose a row truncated (a title, a description, an error). As wide as `code`, set
 *   in the interface face, wrapping at words and keeping its own line breaks.
 */
export type TooltipContent = "label" | "code" | "text";

const contentClass: Record<TooltipContent, string> = {
  label: "",
  code: "whitespace-pre-wrap wrap-anywhere font-mono",
  text: "whitespace-pre-wrap wrap-break-word",
};

/** The width each kind wraps at, before the room left on screen caps it further. */
const contentMaxWidth: Record<TooltipContent, string> = {
  label: "16rem",
  code: "24rem",
  text: "24rem",
};

/** The attribute `TooltipLayer` reads; its value is the panel's text. */
export const TOOLTIP_ATTR = "data-tooltip";

/** A box that may clip its content: the four numbers a truncation check reads. */
export interface ClipBox {
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Layout reports up to a pixel of overflow for text that fits (line boxes, rounding). */
const CUT_SLACK_PX = 1;

/** Whether a box's content runs past its visible area: its text is cut off. */
export function isCutOff(box: ClipBox): boolean {
  return (
    box.scrollWidth > box.clientWidth + CUT_SLACK_PX ||
    box.scrollHeight > box.clientHeight + CUT_SLACK_PX
  );
}

/**
 * The tooltip rule: a hint shows only where its words are not already on screen — for an
 * element that shows no text of its own (an icon-only control, a chart mark, a status glyph)
 * or one whose visible text is cut off. An element whose text is fully visible gets no hint,
 * whatever it carries: a hint that repeats what the reader can see is noise, and one that
 * adds to it hides that information behind a hover. `boxes` are the element and its
 * descendants, measured when the hint would open, since a column resize can cut a label off
 * or give it back at any time.
 */
export function hintAllowed(visibleText: string, boxes: Iterable<ClipBox>): boolean {
  if (visibleText.trim() === "") return true;
  for (const box of boxes) if (isCutOff(box)) return true;
  return false;
}

/** Text a reader cannot see: screen-reader-only copy, or anything the page does not render. */
function unseen(node: Element | null): boolean {
  if (node === null) return false;
  if (node.closest(".sr-only") !== null) return true;
  const check = (node as { checkVisibility?: () => boolean }).checkVisibility;
  return check !== undefined && !check.call(node);
}

/** `hintAllowed`, with its inputs read off the element at the moment the hint would open. */
export function hintAllowedFor(el: Element): boolean {
  let text = "";
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!unseen(node.parentElement)) text += node.textContent ?? "";
  }
  const boxes: ClipBox[] = [];
  for (const node of [el, ...el.querySelectorAll("*")]) {
    // An inline box or a hidden one has no area to clip, and a screen-reader-only span is
    // clipped on purpose — neither says the visible text was cut.
    if (node instanceof HTMLElement && node.clientWidth > 0 && !unseen(node)) boxes.push(node);
  }
  return hintAllowed(text, boxes);
}

/** The trigger's viewport box — the part of a DOMRect the geometry reads. */
export type TriggerRect = Pick<DOMRect, "top" | "bottom" | "left" | "right" | "width" | "height">;

/** The viewport the panel must stay inside, in CSS pixels. */
export interface Viewport {
  width: number;
  height: number;
}

/**
 * The viewport point the panel is pinned at. Exactly one horizontal edge is given: `left`
 * grows the panel rightward from that point, `right` leftward. Anchoring by the far edge is
 * what keeps a panel on screen without anyone measuring a width that does not exist until
 * after it renders — and `room` is the other half of that: how far the panel may grow from
 * its edge before it would cross the margin on the opposite side, the width a long text has
 * to wrap at instead of running off screen.
 */
export interface PanelPosition {
  top: number;
  left?: number;
  right?: number;
  room: number;
}

/**
 * To the right of the trigger — an icon rail against the left edge of the window. Vertically
 * centred on the trigger and clamped so a rail entry scrolled to the very top or bottom still
 * gets a panel on screen.
 */
export function besideTrigger(rect: TriggerRect, viewport: Viewport): PanelPosition {
  const left = rect.right + PANEL_GAP;
  return {
    top: Math.min(
      Math.max(rect.top + rect.height / 2, VIEWPORT_MARGIN),
      viewport.height - VIEWPORT_MARGIN,
    ),
    left,
    room: Math.max(viewport.width - left - VIEWPORT_MARGIN, 0),
  };
}

/**
 * Under the trigger, aligned to whichever of its vertical edges faces the roomier half of the
 * window, so the panel always grows inward. A toolbar button near the right edge of a docked
 * panel is the case this exists for: left-aligned there, the panel would run off screen.
 */
export function belowTrigger(rect: TriggerRect, viewport: Viewport): PanelPosition {
  const top = rect.bottom + PANEL_GAP;
  if (rect.left + rect.width / 2 > viewport.width / 2) {
    const right = Math.max(viewport.width - rect.right, VIEWPORT_MARGIN);
    return { top, right, room: Math.max(viewport.width - right - VIEWPORT_MARGIN, 0) };
  }
  const left = Math.max(rect.left, VIEWPORT_MARGIN);
  return { top, left, room: Math.max(viewport.width - left - VIEWPORT_MARGIN, 0) };
}

export function Tooltip({
  label,
  placement = "right",
  content = "label",
  suppressed,
  className,
  children,
}: {
  /** The words the panel shows — the trigger's own name, so the two cannot disagree. */
  label: string;
  /** Which side of the trigger the panel hangs off; `right` suits a vertical rail, `bottom` a horizontal toolbar. */
  placement?: TooltipPlacement;
  /** What `label` is: a control's name (the default), or a truncated line of code shown whole. */
  content?: TooltipContent;
  /**
   * Hold the panel closed and refuse to open it. For a trigger that owns something else on
   * screen while it is active: the rail avatar's open user menu hangs off the same corner,
   * and a tooltip naming that avatar would sit on top of the menu it just opened.
   */
  suppressed?: boolean;
  /** Extra classes for the wrapper that measures the trigger (e.g. `mt-auto` in a flex column). */
  className?: string;
  children: ReactNode;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Non-null only while the panel is up; the measured viewport point it hangs from. */
  const [position, setPosition] = useState<PanelPosition | null>(null);

  const hide = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPosition(null);
  }, []);

  const show = () => {
    if (suppressed === true || timerRef.current !== null) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const anchor = anchorRef.current;
      // Measured now, not when the trigger rendered: whether its label is cut off depends on
      // the width it has at this moment.
      if (anchor === null || !hintAllowedFor(anchor)) return;
      const rect = anchor.getBoundingClientRect();
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      setPosition(
        placement === "bottom" ? belowTrigger(rect, viewport) : besideTrigger(rect, viewport),
      );
    }, OPEN_DELAY_MS);
  };

  useEffect(() => {
    if (suppressed === true) hide();
  }, [suppressed, hide]);

  // Unmounting with a pending timer would fire a state update on a dead component.
  useEffect(() => hide, [hide]);

  useEffect(() => {
    if (position === null) return;
    // Escape is heard in capture so a focused trigger inside a dialog still dismisses its
    // tooltip, and is deliberately NOT stopped: this panel is not a dismissible layer, and
    // swallowing the key would keep the dialog behind it open on the same press.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    // Capture, because scroll does not bubble. Any scroll dismisses, with none of the
    // portal panel's "did it move the trigger" refinement: this panel is already gone the
    // moment the pointer leaves, so the cost of closing one too eagerly is nothing.
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [position, hide]);

  return (
    <span
      ref={anchorRef}
      className={`flex ${className ?? ""}`}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {position !== null && (
        <TooltipPanel label={label} position={position} content={content} placement={placement} />
      )}
    </span>
  );
}

/** The panel itself, portaled to the body; both ways in render exactly this. */
function TooltipPanel({
  label,
  position,
  content,
  placement,
}: {
  label: string;
  position: PanelPosition;
  content: TooltipContent;
  placement: TooltipPlacement;
}) {
  return createPortal(
    <div
      data-testid="tooltip"
      aria-hidden
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        right: position.right,
        maxWidth: `min(${contentMaxWidth[content]}, ${position.room}px)`,
      }}
      className={`ui-glass anim-fade pointer-events-none z-[60] w-max rounded-md border border-line bg-overlay px-2 py-1 text-xs text-fg shadow-lg ${contentClass[content]} ${placement === "right" ? "-translate-y-1/2" : ""}`}
    >
      {label}
    </div>,
    document.body,
  );
}

export interface TooltipRequest {
  label: string;
  content: TooltipContent;
  placement: TooltipPlacement;
}

/** Reads an element's `data-tooltip` request, or null when it carries none (or an empty one). */
export function tooltipRequest(el: Pick<Element, "getAttribute">): TooltipRequest | null {
  const label = el.getAttribute(TOOLTIP_ATTR);
  if (label === null || label.trim() === "") return null;
  const content = el.getAttribute(`${TOOLTIP_ATTR}-content`);
  const placement = el.getAttribute(`${TOOLTIP_ATTR}-placement`);
  return {
    label,
    content: content === "code" || content === "text" ? content : "label",
    placement: placement === "right" ? "right" : "bottom",
  };
}

/**
 * The document-wide reader of `data-tooltip`, mounted once at the app root. One set of
 * listeners serves every element, so a hint costs an attribute rather than a wrapper and a set
 * of handlers per element. The innermost element carrying the attribute wins, the delay is
 * `<Tooltip>`'s, and the panel closes on leave, blur, Escape, any scroll, a resize and a press
 * — a press because the element is being used now, not asked about.
 */
export function TooltipLayer() {
  const [open, setOpen] = useState<(TooltipRequest & { position: PanelPosition }) | null>(null);

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
    const start = (el: Element | null) => {
      if (el === current) return;
      close();
      if (el === null || tooltipRequest(el) === null) return;
      current = el;
      timer = setTimeout(() => {
        timer = null;
        const el = current;
        const request = el === null ? null : tooltipRequest(el);
        if (el === null || request === null || !el.isConnected || !hintAllowedFor(el)) return;
        const rect = el.getBoundingClientRect();
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        setOpen({
          ...request,
          position:
            request.placement === "right"
              ? besideTrigger(rect, viewport)
              : belowTrigger(rect, viewport),
        });
      }, OPEN_DELAY_MS);
    };
    const onOver = (e: PointerEvent) => start(holder(e.target));
    const onOut = (e: PointerEvent) => {
      if (current === null) return;
      const next = e.relatedTarget;
      if (next instanceof Node && current.contains(next)) return;
      close();
    };
    const onFocusIn = (e: FocusEvent) => start(holder(e.target));
    const onKey = (e: KeyboardEvent) => {
      // Heard, not stopped: the panel is not a dismissible layer, so the same press still
      // reaches the dialog or menu behind it.
      if (e.key === "Escape") close();
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

  return open === null ? null : (
    <TooltipPanel
      label={open.label}
      position={open.position}
      content={open.content}
      placement={open.placement}
    />
  );
}

/**
 * The attributes of a mark whose only content is its hint — a chart segment, a glyph with no
 * words beside it: the hint shows in the shared tooltip, and the same words name the mark for
 * assistive technology, which a `data-tooltip` alone does not.
 */
export function namedHint(label: string): {
  role: "img";
  "aria-label": string;
  "data-tooltip": string;
} {
  return { role: "img", "aria-label": label, "data-tooltip": label };
}
