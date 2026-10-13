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
 * reader can already read in full gets no tooltip. Text that is not read as words does not
 * count — an SVG's own text (an avatar's initial) and anything `aria-hidden` (a letter or a
 * count drawn as an icon). The one exception is a hint marked as carrying what the screen does
 * not show — a consequence, a shortcut, the full value behind an abbreviation, what a state
 * means: `data-tooltip-extra`, or `<Tooltip extra>`, opens it over fully visible text. A hint
 * that only repeats the visible words is never marked, and never shows.
 *
 * Three ways in, one panel:
 * - `<Tooltip label>` wraps its trigger in a measuring span — for a trigger that needs the
 *   wrapper's extras (`suppressed`, a placement beside a rail).
 * - `data-tooltip="…"` on any element, read by the one `<TooltipLayer />` mounted at the app
 *   root, which listens once on the document. It adds no wrapper, so it is what replaces a
 *   `title` in place: a table cell, a truncated span or a flex child keeps its layout exactly.
 *   `data-tooltip-content` picks the panel's kind, `data-tooltip-placement` its side
 *   (default `bottom`), `data-tooltip-extra` marks the hint as adding to the visible text.
 *   Unlike `title`, it names nothing to assistive technology, so an element whose only name
 *   was its title carries an `aria-label` with the same words.
 * - Nothing at all, for a line the page shortens with an ellipsis or a line clamp: hovered or
 *   focused while it is actually cut off, and with no hint of its own around it, it shows its
 *   whole text, so no shortened text is out of reach. A subtree whose hint someone else decides
 *   — a `<Tooltip>` wrapper, a title that scrolls its own tail into view — carries
 *   `data-tooltip-owned` and gets none.
 *
 * Portaled to document.body at fixed viewport coordinates, like every other overlay here
 * (see use-portal-panel.ts): an in-place absolute panel is a descendant of its trigger, so a
 * scrolling or clipping ancestor — a collapsed rail is both — cuts it off. It sits on the
 * portaled-panel layer (z-[60]) and takes no pointer events, so it can never swallow a click
 * meant for what it covers. It is drawn on the overlay surface every menu uses, in the body ink.
 *
 * Two geometries, chosen by the shape of the control strip rather than by taste: `right` for
 * a vertical rail, `bottom` for a horizontal toolbar, where a panel to the side would cover
 * the very buttons next to the one being asked about. A `bottom` panel with no room under its
 * trigger — a toolbar at the foot of the window — turns over it instead (`belowTrigger`).
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
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * Open delay. Long enough that a pointer crossing a column of icons on its way elsewhere
 * leaves no trail of popping panels, short enough to answer a pointer that stopped to ask.
 * Exported because it is the app's one hover timing: the "?" disclosure
 * (`useHoverDisclosure`) opens after the same wait.
 */
export const HOVER_OPEN_DELAY_MS = 400;

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

/**
 * Marks a `data-tooltip` as carrying what the screen does not show, so it opens over text the
 * reader can see in full. Any value but `"false"` sets it, so `data-tooltip-extra={cond}`
 * reads as written; a shared component writes `{cond || undefined}`, leaving no attribute on
 * the instances that are not marked.
 */
export const TOOLTIP_EXTRA_ATTR = "data-tooltip-extra";

/**
 * Marks a subtree whose hover hint someone else decides (a `<Tooltip>` wrapper, a title that
 * scrolls its own tail into view), so the layer shows no full-text hint for a line inside it.
 */
export const TOOLTIP_OWNED_ATTR = "data-tooltip-owned";

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
 * or one whose visible text is cut off. An element whose text is fully visible gets no hint:
 * one that repeats what the reader can see is noise. The exception is `extra`, a hint the
 * caller marked as carrying what the screen does not show (a consequence, a shortcut, the full
 * value behind an abbreviation, what a state means), which shows whatever the text. `boxes`
 * are the element and its descendants, measured when the hint would open, since a column
 * resize can cut a label off or give it back at any time.
 */
export function hintAllowed(visibleText: string, boxes: Iterable<ClipBox>, extra = false): boolean {
  if (extra || visibleText.trim() === "") return true;
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

/** The part of a DOM node `readingText` walks; structural, so a hand-built tree serves too. */
export interface ReadingNode {
  nodeType: number;
  nodeValue: string | null;
  childNodes: ArrayLike<ReadingNode>;
  localName?: string;
  getAttribute?(name: string): string | null;
  classList?: { contains(token: string): boolean };
  checkVisibility?(): boolean;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * Whether an element's text is out of the reading: an SVG's (an avatar's initial is part of a
 * picture), anything hidden from assistive technology (a letter or a count drawn as an icon,
 * its control named elsewhere), screen-reader-only copy, and anything the page does not render.
 */
function outOfReading(el: ReadingNode): boolean {
  return (
    el.localName === "svg" ||
    el.getAttribute?.("aria-hidden") === "true" ||
    el.classList?.contains("sr-only") === true ||
    el.checkVisibility?.() === false
  );
}

/** The words a reader reads in a subtree: its text, minus any inside an element out of the reading. */
export function readingText(node: ReadingNode): string {
  if (node.nodeType === TEXT_NODE) return node.nodeValue ?? "";
  if (node.nodeType !== ELEMENT_NODE || outOfReading(node)) return "";
  let text = "";
  for (let i = 0; i < node.childNodes.length; i++) text += readingText(node.childNodes[i]!);
  return text;
}

/** Whether an element's `data-tooltip` is marked as adding to its visible text. */
function marksExtra(el: Pick<Element, "getAttribute">): boolean {
  const value = el.getAttribute(TOOLTIP_EXTRA_ATTR);
  return value !== null && value !== "false";
}

/** The boxes of an element and its descendants that can clip text, measured only as read. */
function* clipBoxes(el: Element): Generator<ClipBox> {
  for (const node of [el, ...el.querySelectorAll("*")]) {
    // An inline box or a hidden one has no area to clip, and a screen-reader-only span is
    // clipped on purpose — neither says the visible text was cut.
    if (node instanceof HTMLElement && node.clientWidth > 0 && !unseen(node)) yield node;
  }
}

/**
 * `hintAllowed`, with its inputs read off the element at the moment the hint would open;
 * `extra` is the caller's mark that the hint adds to the visible text.
 */
export function hintAllowedFor(el: Element, extra = false): boolean {
  return hintAllowed(readingText(el), clipBoxes(el), extra);
}

/** The computed styles that say how an element sets its text: the part of a CSSStyleDeclaration read here. */
export interface LineStyle {
  textOverflow: string;
  /** `-webkit-line-clamp`: `none`, or the number of lines kept. */
  lineClamp: string;
  fontFamily: string;
}

/** Whether an element shortens its own text: an ellipsis (`truncate`) or a line clamp. */
export function shortensText(style: LineStyle): boolean {
  return (
    style.textOverflow === "ellipsis" || (style.lineClamp !== "" && style.lineClamp !== "none")
  );
}

/** The part of a DOM element the search for a shortened line walks; structural, so a hand-built tree serves too. */
export interface LineNode {
  parentElement: LineNode | null;
  hasAttribute(name: string): boolean;
  matches(selector: string): boolean;
  querySelectorAll(selector: string): ArrayLike<LineNode>;
}

/** How far up from the hovered node a shortened line is looked for. */
const LINE_SEARCH_DEPTH = 4;

/**
 * How many of a control's descendants are looked through for its shortened line: a row button
 * holds a title, a description and a few marks, never a whole panel.
 */
const LINE_SEARCH_WITHIN = 40;

/** A control a pointer or focus rests on as a whole, so the line inside it is what is asked about. */
const CONTROL_SELECTOR =
  "button, a[href], [role='button'], [role='menuitem'], [role='option'], [role='tab'], summary";

/** What a hovered or focused node asks about when it carries no hint: where it rests, and the lines that may be cut off there. */
export interface LineSubject<T> {
  /** The element the pointer or focus rests on as far as the hint goes: the line, or the control holding the lines. */
  at: T;
  /** The shortened lines, in document order; the first one cut off when the hint would open is shown. */
  lines: T[];
}

/**
 * The shortened lines a hovered or focused node stands for, or null: the node or one of its
 * nearest ancestors when that one shortens its text, else — for a control, which is asked about
 * as a whole — every line inside it that does (a row's title and its description). Nothing
 * inside a subtree marked `data-tooltip-owned` counts. Whether a line is actually cut off is
 * measured later, when the hint would open, since a resize can cut it off or give it back.
 */
export function shortenedLines<T extends LineNode>(
  start: T,
  styleOf: (node: T) => LineStyle,
): LineSubject<T> | null {
  let node: T | null = start;
  for (let depth = 0; node !== null && depth <= LINE_SEARCH_DEPTH; depth++) {
    if (node.hasAttribute(TOOLTIP_OWNED_ATTR)) return null;
    if (shortensText(styleOf(node))) return { at: node, lines: [node] };
    node = node.parentElement as T | null;
  }
  if (!start.matches(CONTROL_SELECTOR)) return null;
  const inside = start.querySelectorAll("*");
  const lines: T[] = [];
  for (let i = 0; i < inside.length && i < LINE_SEARCH_WITHIN; i++) {
    const candidate = inside[i] as T;
    if (shortensText(styleOf(candidate)) && !ownedWithin(candidate, start)) lines.push(candidate);
  }
  return lines.length === 0 ? null : { at: start, lines };
}

/** Whether `node`, or an ancestor of it up to and including `root`, is marked `data-tooltip-owned`. */
function ownedWithin(node: LineNode, root: LineNode): boolean {
  for (let at: LineNode | null = node; at !== null; at = at.parentElement) {
    if (at.hasAttribute(TOOLTIP_OWNED_ATTR)) return true;
    if (at === root) return false;
  }
  return false;
}

/** The computed `LineStyle` of a DOM element. */
function lineStyleOf(el: Element): LineStyle {
  const style = getComputedStyle(el);
  return {
    textOverflow: style.textOverflow,
    lineClamp: style.getPropertyValue("-webkit-line-clamp"),
    fontFamily: style.fontFamily,
  };
}

/**
 * The request for a shortened line's whole text: its reading text, in the code panel when the
 * line is set in a monospace face (a path, a command), in the text panel otherwise.
 */
export function lineRequest(text: string, style: LineStyle): TooltipRequest | null {
  const label = text.trim();
  if (label === "") return null;
  return {
    label,
    content: /mono/i.test(style.fontFamily) ? "code" : "text",
    placement: "bottom",
    extra: false,
  };
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
 * to wrap at instead of running off screen. Exactly one vertical edge is given too: `top`
 * hangs the panel down from that point, `bottom` stands it up from there.
 */
export interface PanelPosition {
  top?: number;
  bottom?: number;
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
 *
 * Over the trigger instead when the panel, `height` tall as rendered, would cross the window's
 * bottom margin and there is more room above: a control at the foot of the window (the
 * composer's toolbar, with its context ring) would otherwise hang its hint past the bottom
 * edge. Above, the panel is pinned by its bottom edge, so it grows upward from the trigger
 * however many lines its text wraps to. Without a height (not rendered yet) it hangs below.
 */
export function belowTrigger(rect: TriggerRect, viewport: Viewport, height = 0): PanelPosition {
  const roomBelow = viewport.height - VIEWPORT_MARGIN - (rect.bottom + PANEL_GAP);
  const roomAbove = rect.top - PANEL_GAP - VIEWPORT_MARGIN;
  const vertical =
    height > roomBelow && roomAbove > roomBelow
      ? { bottom: viewport.height - rect.top + PANEL_GAP }
      : { top: rect.bottom + PANEL_GAP };
  if (rect.left + rect.width / 2 > viewport.width / 2) {
    const right = Math.max(viewport.width - rect.right, VIEWPORT_MARGIN);
    return { ...vertical, right, room: Math.max(viewport.width - right - VIEWPORT_MARGIN, 0) };
  }
  const left = Math.max(rect.left, VIEWPORT_MARGIN);
  return { ...vertical, left, room: Math.max(viewport.width - left - VIEWPORT_MARGIN, 0) };
}

export function Tooltip({
  label,
  placement = "right",
  content = "label",
  extra = false,
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
  /** `label` carries what the screen does not show (a shortcut, a consequence): open it over visible text too. */
  extra?: boolean;
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
  /** Non-null only while the panel is up; the trigger's box, measured as it opened. */
  const [anchor, setAnchor] = useState<TriggerRect | null>(null);

  const hide = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setAnchor(null);
  }, []);

  const show = () => {
    if (suppressed === true || timerRef.current !== null) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const trigger = anchorRef.current;
      // Measured now, not when the trigger rendered: whether its label is cut off depends on
      // the width it has at this moment.
      if (trigger === null || !hintAllowedFor(trigger, extra)) return;
      setAnchor(trigger.getBoundingClientRect());
    }, HOVER_OPEN_DELAY_MS);
  };

  useEffect(() => {
    if (suppressed === true) hide();
  }, [suppressed, hide]);

  // Unmounting with a pending timer would fire a state update on a dead component.
  useEffect(() => hide, [hide]);

  useEffect(() => {
    if (anchor === null) return;
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
  }, [anchor, hide]);

  return (
    <span
      ref={anchorRef}
      {...{ [TOOLTIP_OWNED_ATTR]: "" }}
      className={`flex ${className ?? ""}`}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {anchor !== null && (
        <TooltipPanel label={label} anchor={anchor} content={content} placement={placement} />
      )}
    </span>
  );
}

/**
 * The panel itself, portaled to the body; both ways in render exactly this. It places itself
 * against the trigger's box: beside a rail entry, or under a toolbar control — and over it when
 * there is no room below, which takes the panel's rendered height. That height is read in the
 * layout phase, before the first paint, so a panel that belongs above is never seen below.
 */
function TooltipPanel({
  label,
  anchor,
  content,
  placement,
}: {
  label: string;
  /** The trigger's viewport box, measured when the panel opened. */
  anchor: TriggerRect;
  content: TooltipContent;
  placement: TooltipPlacement;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  // Read at render: the panel closes on any resize, so the window it was placed in is current.
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const position =
    placement === "right"
      ? besideTrigger(anchor, viewport)
      : belowTrigger(anchor, viewport, height);
  // `offsetHeight`, not the bounding rect: it is the laid-out height whatever the opening
  // animation does to the panel's transform on its first frame.
  useLayoutEffect(() => {
    if (placement === "bottom" && panelRef.current !== null) {
      setHeight(panelRef.current.offsetHeight);
    }
  }, [anchor, label, content, placement]);
  return createPortal(
    <div
      ref={panelRef}
      data-testid="tooltip"
      aria-hidden
      style={{
        position: "fixed",
        top: position.top,
        bottom: position.bottom,
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
  /** Marked `data-tooltip-extra`: the hint adds to the visible text, so it opens over it. */
  extra: boolean;
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
    extra: marksExtra(el),
  };
}

/**
 * The document-wide reader of `data-tooltip`, mounted once at the app root. One set of
 * listeners serves every element, so a hint costs an attribute rather than a wrapper and a set
 * of handlers per element. The innermost element carrying the attribute wins, the delay is
 * `<Tooltip>`'s, and the panel closes on leave, blur, Escape, any scroll, a resize and a press
 * — a press because the element is being used now, not asked about.
 *
 * Where no element carries a hint, a shortened line (`shortenedLines`) that is cut off when the
 * hint would open shows its whole text: a hint nobody wrote, so that no ellipsis hides text
 * for good.
 */
export function TooltipLayer() {
  const [open, setOpen] = useState<(TooltipRequest & { anchor: TriggerRect }) | null>(null);

  useEffect(() => {
    /** What the pointer or focus rests on: an element carrying a hint (no lines), or a line subject. */
    let current: LineSubject<Element> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const close = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      current = null;
      setOpen(null);
    };
    const holder = (node: EventTarget | null): Element | null =>
      node instanceof Element ? node.closest(`[${TOOLTIP_ATTR}]`) : null;
    /** What a node asks about: the element carrying a hint around it, else its shortened lines. */
    const subject = (node: EventTarget | null): LineSubject<Element> | null => {
      if (!(node instanceof Element)) return null;
      const hinted = holder(node);
      return hinted !== null ? { at: hinted, lines: [] } : shortenedLines(node, lineStyleOf);
    };
    /**
     * The hint the subject shows now, and the element it hangs under: its own request where it
     * carries one, else the whole text of its first line that is cut off at this moment.
     */
    const requestFor = (
      subject: LineSubject<Element>,
    ): { request: TooltipRequest; under: Element } | null => {
      const own = tooltipRequest(subject.at);
      if (own !== null) {
        return hintAllowedFor(subject.at, own.extra) ? { request: own, under: subject.at } : null;
      }
      for (const line of subject.lines) {
        if (!(line instanceof HTMLElement) || !isCutOff(line)) continue;
        const request = lineRequest(readingText(line), lineStyleOf(line));
        if (request !== null) return { request, under: line };
      }
      return null;
    };
    const start = (next: LineSubject<Element> | null) => {
      if (next !== null && next.at === current?.at) return;
      close();
      if (next === null) return;
      current = next;
      timer = setTimeout(() => {
        timer = null;
        const subject = current;
        if (subject === null || !subject.at.isConnected) return;
        const found = requestFor(subject);
        if (found === null) return;
        setOpen({ ...found.request, anchor: found.under.getBoundingClientRect() });
      }, HOVER_OPEN_DELAY_MS);
    };
    const onOver = (e: PointerEvent) => start(subject(e.target));
    const onOut = (e: PointerEvent) => {
      if (current === null) return;
      const next = e.relatedTarget;
      if (next instanceof Node && current.at.contains(next)) return;
      close();
    };
    const onFocusIn = (e: FocusEvent) => start(subject(e.target));
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
      anchor={open.anchor}
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
